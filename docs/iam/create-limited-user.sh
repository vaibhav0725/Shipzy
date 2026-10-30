#!/usr/bin/env bash
# Creates an IAM user that can run deployer and nothing else, and stores its access key in a local AWS profile.
# Run it ONCE with credentials that can manage IAM (your current admin profile):
#
#   AWS_PROFILE=<your-admin-profile> bash docs/iam/create-limited-user.sh [new-profile-name]
#
# The new key is written straight into ~/.aws/credentials. It is never printed.
set -euo pipefail

PROFILE_NAME="${1:-deployer-lp}"
USER_NAME="deployer-cli"
POLICY_NAME="DeployerCliAccess"
HERE="$(cd "$(dirname "$0")" && pwd)"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Account $ACCOUNT"

DOC="$(mktemp)"
trap 'rm -f "$DOC"' EXIT
sed "s/ACCOUNT_ID/$ACCOUNT/g" "$HERE/deployer-cli-policy.json" > "$DOC"

POLICY_ARN="arn:aws:iam::$ACCOUNT:policy/$POLICY_NAME"
if aws iam get-policy --policy-arn "$POLICY_ARN" > /dev/null 2>&1; then
  echo "Policy $POLICY_NAME exists; adding the current text as the new default version."
  # IAM keeps at most 5 versions; drop the oldest non-default one if needed.
  OLD="$(aws iam list-policy-versions --policy-arn "$POLICY_ARN" --query 'Versions[?!IsDefaultVersion]|[-1].VersionId' --output text)"
  COUNT="$(aws iam list-policy-versions --policy-arn "$POLICY_ARN" --query 'length(Versions)' --output text)"
  if [ "$COUNT" -ge 5 ] && [ "$OLD" != "None" ]; then aws iam delete-policy-version --policy-arn "$POLICY_ARN" --version-id "$OLD"; fi
  aws iam create-policy-version --policy-arn "$POLICY_ARN" --policy-document "file://$DOC" --set-as-default > /dev/null
else
  aws iam create-policy --policy-name "$POLICY_NAME" --policy-document "file://$DOC" > /dev/null
  echo "Created policy $POLICY_NAME"
fi

if ! aws iam get-user --user-name "$USER_NAME" > /dev/null 2>&1; then
  aws iam create-user --user-name "$USER_NAME" > /dev/null
  echo "Created user $USER_NAME"
fi
aws iam attach-user-policy --user-name "$USER_NAME" --policy-arn "$POLICY_ARN"

if [ "$(aws iam list-access-keys --user-name "$USER_NAME" --query 'length(AccessKeyMetadata)' --output text)" != "0" ]; then
  echo "$USER_NAME already has an access key. Delete it first if you want a new one:"
  echo "  aws iam list-access-keys --user-name $USER_NAME"
  exit 1
fi

KEY="$(aws iam create-access-key --user-name "$USER_NAME" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)"
aws configure set aws_access_key_id "$(echo "$KEY" | cut -f1)" --profile "$PROFILE_NAME"
aws configure set aws_secret_access_key "$(echo "$KEY" | cut -f2)" --profile "$PROFILE_NAME"
aws configure set region "${AWS_REGION:-us-east-1}" --profile "$PROFILE_NAME"
unset KEY

echo
echo "Done. Profile '$PROFILE_NAME' now belongs to the limited user."
echo "Try it:   AWS_PROFILE=$PROFILE_NAME deployer status"
echo "New keys take a few seconds to work."
