# deployer (working name)

> **Full documentation:** [docs/GUIDE.md](docs/GUIDE.md) covers how it works, every feature, how to use it, and troubleshooting.

Open-source, bring-your-own-AWS deployer for static React apps. Everything runs in **your** AWS
account: an S3 bucket, a CloudFront distribution, and a CloudFront KeyValueStore that maps hosts to
immutable deployments, so promote and rollback are a single routing update (visible at the edge in about 30 seconds, with no re-upload or distribution update).

## Status
Phases 1 and 2 are done (local and remote builds, rollback, GitHub push deploys) along with build-time
environment variables, custom domains (HTTPS, Route 53 automation) and a local web dashboard. No hosted dashboard or preview URLs yet.

## Setup
```sh
npm install
npm run build          # builds the shared code, the Lambda zip, the stack template and the single-file CLI
cd apps/cli && npm link && cd ../..   # puts a real `deployer` command on your PATH
export AWS_PROFILE=deployer-dev       # use an IAM user or SSO profile, not root
deployer --version
```

`npm unlink -g @deployer/cli` removes it again. Inside the repo you can also run `npm run deployer -- <command>`.

## Usage
```sh
deployer init                                   # create the stack (~5 min)
deployer deploy ./my-react-app --project demo   # build, upload, promote
deployer deploy ./my-react-app --remote         # build in CodeBuild in your AWS account instead
deployer builds                                 # recent remote builds
deployer logs <build> -f                        # a build's log (id from `builds`)
deployer env set -p demo VITE_API_URL https://api.example.com   # build-time variable for remote/GitHub builds
deployer env ls -p demo                                    # names only; values are never shown
deployer github connect -p demo --repo owner/name   # deploy on every push (asks for a GitHub token)
deployer github deploy -p demo                  # build the connected branch's current head now
deployer github disconnect -p demo
deployer domain add app.example.com -p demo     # your own hostname with HTTPS (certificate, distribution, DNS)
deployer domain ls                              # domains and their state
deployer domain rm app.example.com              # remove it completely
deployer dashboard                              # local web UI: deploy from a folder or GitHub, manage everything
deployer status                                 # account, stack, URL, totals
deployer list                                   # all projects: live host, version, size
deployer list --project demo                    # one project's deployments
deployer rollback --project demo                # back to the previous deployment
deployer prune --project demo --dry-run           # preview cleanup
deployer delete --project demo                  # remove one project: sites, sources, webhook (asks to confirm)
deployer destroy                                # remove the whole stack: sites, webhooks, both buckets
```

`list` and `status` accept `--json` for scripting.

Global options: `--profile`, `--region` (default `us-east-1`), `--stack-name` (default `Deployer`).

## Remote builds
`deploy --remote` zips your source (honouring `.gitignore`; never `node_modules`, `dist`, `build` or `.env*`),
uploads it to your account, and builds it in CodeBuild, then streams the log. Add `--detach` to return at once and
follow later with `logs <build> -f`. Ctrl-C stops watching, not the build. Remote builds take about 1.5 minutes
before your own build even starts (CodeBuild provisioning), so the local `deploy` stays the fast option while
iterating. Build-time environment variables (`.env` files) are not supported in remote builds yet.

## GitHub push deploys
`github connect` stores a GitHub token in your account (Secrets Manager), registers a push webhook on the repository,
and remembers the repo and branch for the project. A push then reaches the webhook Lambda, which builds that commit in
CodeBuild and promotes it, exactly like `deploy --remote`.

- **Token:** a fine-grained token with *Contents: read* and *Webhooks: read and write* on the repository (or a classic
  token with `repo` and `admin:repo_hook`). Pass it as `GITHUB_TOKEN` or type it when asked (input is hidden). It is
  validated before anything is stored. One token serves the whole account; `--reuse-token` skips asking again.
- **Webhook security:** the Function URL is public by design. Every request must carry GitHub's HMAC signature, made
  with a secret generated in your account, or it gets a 401 and starts nothing.
- **Several projects can follow one repo**, each on its own branch or host; the webhook is shared and removed with the
  last project. `--branch`, `--host`, `--install-command` and `--build-command` are saved per project.
- If the CLI cannot register the webhook (for example a token without webhook permission), it prints the exact
  settings to enter by hand.

## Storage cleanup
Every deploy is a full, immutable copy, so the CLI keeps storage bounded:
- A deploy that fails removes its own partial upload (unless the route already points at it).
- After each successful deploy, only the newest `--keep` deployments (default 10) are retained, plus
  any that a host is routed to. Older ones are deleted, which limits how far back you can roll back.
- `deployer prune` also removes uploads that were never promoted, such as from an interrupted deploy.
  Unrecorded uploads younger than `--grace-minutes` (default 60) are left alone in case a deploy is running.

## How it works
- `packages/core`: code shared by the CLI and the Lambdas (routing table, deployment history, pruning).
- `packages/stack`: CDK app. `npm run build` synthesizes it to `apps/cli/assets/template.json`.
  It has no file assets, so no `cdk bootstrap` is needed; the CLI deploys the template directly with CloudFormation.
- `packages/engine`: two Lambda functions, bundled to `apps/cli/assets/engine.zip`. `deployer init` uploads the
  zip to the Builds bucket and points the stack at it. `promote` publishes a finished build; `webhook` receives
  GitHub push events (the public URL is protected by an HMAC signature, not by being secret).
- `apps/cli`: builds the React app locally, uploads it to `s3://<bucket>/<project>/<deployment-id>/`,
  then points `host:<hostname>` in the KeyValueStore at that prefix. A CloudFront Function
  (`packages/stack/edge/router.js`) rewrites each request using that mapping and falls back to
  `index.html` for client-side routes.

## What `init` creates in your account
The three original resources (private S3 bucket, CloudFront distribution, KeyValueStore) plus the pieces for
builds in AWS: a CodeBuild project, a Builds bucket (uploaded sources expire after 7 days), the two Lambdas,
two secrets, and three IAM roles for CodeBuild, the engine and the webhook. Each role is limited to this stack's
own buckets, routing table, build project and secrets. `init` needs `CAPABILITY_IAM` and is safe to rerun.
Logs are kept for 14 days. CodeBuild's free tier is 100 build-minutes a month.

## Removing things
- `delete -p <project>` removes the project's routes, deployment folders, uploaded sources and its history, and
  takes the GitHub webhook off the repository (unless another project deploys from the same repo).
- `destroy` takes the webhooks off every connected repository, empties both buckets, then deletes the stack.
  Verified on a throwaway stack: nothing it created is left behind, including its secrets.

## More than one stack
`--stack-name` creates an independent stack in the same account, for example a staging copy. Names that CDK would
otherwise derive from the construct path (the routing table, router function and origin access control) are made
stack-specific, except for a stack called `Deployer`, which keeps its original names so existing installs are not
replaced when they update.

Without a custom domain a project is served at the CloudFront domain, so the last project deployed there
wins. With `domain add`, each project gets its own hostname; a deploy updates all of a project's hosts (or the
host you pass with `--host`), and rollback moves them together. See section 5.5 of the guide, including how to use a
GoDaddy or other registrar domain by delegating a subdomain to Route 53.

License: Apache-2.0
