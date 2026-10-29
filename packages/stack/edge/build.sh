# Runs inside CodeBuild for every deploy. Inputs arrive as environment variables:
#   fixed by the stack:  SITES_BUCKET BUILDS_BUCKET ENGINE_FUNCTION GITHUB_TOKEN_SECRET DEFAULT_HOST
#   per build:           DEPLOY_PROJECT DEPLOY_ID [DEPLOY_HOSTS] [DEPLOY_KEEP]   (hosts: comma-separated; default is decided by the engine)
#                        SOURCE_TYPE (s3|github) SOURCE_S3_KEY | SOURCE_REPO SOURCE_REF
#                        [INSTALL_COMMAND] [BUILD_COMMAND]
set -euo pipefail

: "${DEPLOY_PROJECT:?}" "${DEPLOY_ID:?}" "${SOURCE_TYPE:?}"
SRC=/tmp/source
mkdir -p "$SRC"

echo "==> Fetching source ($SOURCE_TYPE)"
case "$SOURCE_TYPE" in
  s3)
    aws s3 cp "s3://$BUILDS_BUCKET/${SOURCE_S3_KEY:?}" /tmp/source.zip --only-show-errors
    unzip -q /tmp/source.zip -d "$SRC"
    ;;
  github)
    # The token goes in a request header, never in the URL, so it cannot leak into error output.
    TOKEN="$(aws secretsmanager get-secret-value --secret-id "$GITHUB_TOKEN_SECRET" --query SecretString --output text)"
    AUTH="Authorization: Basic $(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)"
    export GIT_TERMINAL_PROMPT=0   # fail instead of asking for a username
    git -C "$SRC" init -q
    if ! git -C "$SRC" -c "http.extraHeader=$AUTH" fetch -q --depth 1 "https://github.com/${SOURCE_REPO:?}.git" "${SOURCE_REF:?}"; then
      echo "Could not fetch ${SOURCE_REPO} at ${SOURCE_REF:0:7}."
      echo "Check that the repository exists and that the stored GitHub token can read it."
      echo "(Store a new token with: deployer github connect -p <project> --repo ${SOURCE_REPO})"
      exit 1
    fi
    git -C "$SRC" checkout -q FETCH_HEAD
    ;;
  *)
    echo "Unknown SOURCE_TYPE: $SOURCE_TYPE"
    exit 1
    ;;
esac

cd "$SRC"
[ -f package.json ] || { echo "No package.json at the project root."; exit 1; }

node -e '
const pkg = require("./package.json");
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
if (deps.next) { console.error("Next.js is not supported yet: only static React (Vite / Create React App) projects."); process.exit(1); }
if (!deps.react) { console.error("This does not look like a React project (no react dependency)."); process.exit(1); }
'

if [ -f pnpm-lock.yaml ]; then
  PM=pnpm; INSTALL="pnpm install --frozen-lockfile"; corepack enable
elif [ -f yarn.lock ]; then
  PM=yarn; INSTALL="yarn install --frozen-lockfile"; corepack enable
elif [ -f package-lock.json ]; then
  PM=npm; INSTALL="npm ci"
else
  PM=npm; INSTALL="npm install"
fi

echo "==> Installing: ${INSTALL_COMMAND:-$INSTALL}"
bash -c "${INSTALL_COMMAND:-$INSTALL}"
echo "==> Building: ${BUILD_COMMAND:-$PM run build}"
bash -c "${BUILD_COMMAND:-$PM run build}"

OUT=""
for d in dist build; do
  if [ -f "$d/index.html" ]; then OUT="$d"; break; fi
done
[ -n "$OUT" ] || { echo "Build output not found: expected dist/index.html or build/index.html."; exit 1; }

DEST="s3://$SITES_BUCKET/$DEPLOY_PROJECT/$DEPLOY_ID"
UPLOADED=0
INVOKED=0
# Until the engine has been asked to promote, a failed build owns its partial upload and removes it.
# After that the engine owns cleanup (it must not delete a folder a route may already point at).
cleanup() {
  if [ "$UPLOADED" = 1 ] && [ "$INVOKED" = 0 ]; then
    echo "==> Removing partial upload"
    aws s3 rm "$DEST/" --recursive --only-show-errors || true
  fi
}
trap cleanup EXIT

echo "==> Uploading $OUT to $DEST"
UPLOADED=1
# Same cache rules as the CLI: html always revalidates, hashed bundler output is immutable.
aws s3 sync "$OUT" "$DEST/" --cache-control "public, max-age=3600" --only-show-errors
for d in assets static; do
  if [ -d "$OUT/$d" ]; then
    aws s3 cp "$OUT/$d" "$DEST/$d" --recursive --cache-control "public, max-age=31536000, immutable" --only-show-errors
  fi
done
find "$OUT" -name '*.html' | while IFS= read -r f; do
  aws s3 cp "$f" "$DEST/${f#"$OUT"/}" --cache-control no-cache --only-show-errors
done
FILES="$(find "$OUT" -type f | wc -l | tr -d ' ')"

echo "==> Promoting $DEPLOY_PROJECT/$DEPLOY_ID"
PAYLOAD="$(jq -nc --arg project "$DEPLOY_PROJECT" --arg id "$DEPLOY_ID" --arg hosts "${DEPLOY_HOSTS:-}" \
  --argjson keep "${DEPLOY_KEEP:-10}" --argjson files "$FILES" \
  '{action:"promote",project:$project,id:$id,hosts:(if $hosts == "" then null else ($hosts | split(",")) end),keep:$keep,files:$files}')"
INVOKED=1
aws lambda invoke --function-name "$ENGINE_FUNCTION" --cli-read-timeout 300 --cli-binary-format raw-in-base64-out \
  --payload "$PAYLOAD" /tmp/promote.json > /tmp/invoke.json
cat /tmp/promote.json; echo
if jq -e 'has("FunctionError")' /tmp/invoke.json > /dev/null; then
  echo "Promote failed."
  exit 1
fi
echo "==> Live: $(jq -r '.urls | join(", ")' /tmp/promote.json)"
