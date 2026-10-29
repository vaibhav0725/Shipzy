# deployer (working name)

Open-source, bring-your-own-AWS deployer for static React apps. Everything runs in **your** AWS
account: an S3 bucket, a CloudFront distribution, and a CloudFront KeyValueStore that maps hosts to
immutable deployments, so promote and rollback are a single routing update (visible at the edge in about 30 seconds, with no re-upload or distribution update).

## Status
Phase 1: stack + CLI. No dashboard, GitHub integration or custom domains yet.

## Setup
```sh
npm install
npm run build          # synthesizes the CloudFormation template and compiles the CLI
export AWS_PROFILE=deployer-dev   # use an IAM user or SSO profile, not root
```

## Usage
```sh
npm run deployer -- init                                   # create the stack (~5 min)
npm run deployer -- deploy ./my-react-app --project demo   # build, upload, promote
npm run deployer -- deploy ./my-react-app --remote         # build in CodeBuild in your AWS account instead
npm run deployer -- builds                                 # recent remote builds
npm run deployer -- logs <build> -f                        # a build's log (id from `builds`)
npm run deployer -- status                                 # account, stack, URL, totals
npm run deployer -- list                                   # all projects: live host, version, size
npm run deployer -- list --project demo                    # one project's deployments
npm run deployer -- rollback --project demo                # back to the previous deployment
npm run deployer -- prune --project demo --dry-run           # preview cleanup
npm run deployer -- delete --project demo                  # remove one project (asks to confirm)
npm run deployer -- destroy                                # remove everything
```

`list` and `status` accept `--json` for scripting.

Global options: `--profile`, `--region` (default `us-east-1`), `--stack-name` (default `Deployer`).

## Remote builds
`deploy --remote` zips your source (honouring `.gitignore`; never `node_modules`, `dist`, `build` or `.env*`),
uploads it to your account, and builds it in CodeBuild, then streams the log. Add `--detach` to return at once and
follow later with `logs <build> -f`. Ctrl-C stops watching, not the build. Remote builds take about 1.5 minutes
before your own build even starts (CodeBuild provisioning), so the local `deploy` stays the fast option while
iterating. Build-time environment variables (`.env` files) are not supported in remote builds yet.

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

Until custom domains land, a project is served at the CloudFront domain, so the last project deployed
to the default host wins; use `--host` to serve several projects.

License: Apache-2.0
