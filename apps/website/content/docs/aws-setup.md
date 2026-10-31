---
title: AWS setup
description: Choose credentials, create a least-privilege user, pick a region, and know what init creates.
section: Start
order: 2
---

shipzy acts on your AWS account with the credentials you give it. This page covers how to do that safely.

## Credentials

shipzy reads your AWS profile the same way the AWS CLI does. Use any of:

- a named profile: `shipzy --profile my-profile status`, or `export AWS_PROFILE=my-profile`;
- an SSO profile (`aws sso login`);
- environment variables (`AWS_ACCESS_KEY_ID` and so on).

> **Never use root access keys.** Create an IAM user or use SSO. Any access key that has ever been pasted into a chat, ticket or log should be deactivated and replaced.

## Least-privilege access (recommended)

An administrator key works, but it is far more than shipzy needs. We publish a policy that allows only what shipzy does, and a script that creates a user with it.

1. Download the policy and the script, and **read them**:
   - [deployer-cli-policy.json](/iam/deployer-cli-policy.json)
   - [create-limited-user.sh](/iam/create-limited-user.sh)
2. Run the script with an administrator profile. It creates a managed policy and an IAM user, and writes the new key straight into a local AWS profile without printing it:

   ```sh
   AWS_PROFILE=<your-admin-profile> bash create-limited-user.sh
   ```

3. Use the new profile from then on:

   ```sh
   AWS_PROFILE=deployer-lp shipzy status
   ```

What the policy allows, in words:

- CloudFormation stacks, S3 buckets, Lambda functions and IAM roles **whose names start with `Deployer`** (the default stack name);
- CloudFront, CodeBuild, certificates, Route 53 records, the stack's own parameters and its two secrets;
- nothing else: not your other buckets, not other IAM users or access keys, not other services.

If you use a different stack name (`--stack-name Staging`), replace the `Deployer` prefix in the policy with it.

> **A limit worth knowing.** The policy can create IAM roles named for the stack. Someone holding that key could attach extra rights to such a role, so treat the key as sensitive and do not share it.

## Region

The default region is `us-east-1`. Use `--region eu-west-1` (or set `AWS_REGION`) to put the stack elsewhere. Certificates for custom domains are always requested in `us-east-1`, because CloudFront requires that, whatever your stack's region is.

## What `init` creates

One CloudFormation stack, named `Deployer` by default. You can see it in the AWS console and change or delete it.

| Resource | What it is for |
|---|---|
| S3 bucket (private) | Every deploy of every project, and each project's history |
| S3 bucket (private) | Uploaded sources, the engine code and the build script |
| CloudFront distribution | Serves your sites over HTTPS; the only reader of the sites bucket |
| CloudFront Function and KeyValueStore | The router and the routing table |
| CodeBuild project | Runs remote and GitHub builds |
| Two Lambda functions | One receives GitHub webhooks, one publishes a finished build |
| Secrets Manager (two secrets) | The webhook signing secret and your GitHub token |
| Three IAM roles | Build, engine and webhook, each limited to this stack's own resources |

Each project's first deploy adds a small stack with a CloudFront distribution (its own address), and each custom domain adds another with a certificate. Environment variables are stored as encrypted parameters under `/deployer/<stack>/`.

The names `Deployer`, `Deployer*` and `/deployer/` are internal labels from before the project was renamed. They stay as they are so existing stacks keep working.

## Several stacks

`--stack-name` lets you keep independent stacks in one account, for example a staging copy:

```sh
shipzy --stack-name Staging init
shipzy --stack-name Staging deploy ./my-app --project my-app
```

## Removing everything

```sh
shipzy destroy
```

This removes the GitHub webhooks, custom domains, project addresses and variables, empties both buckets, and deletes the stack. It asks you to type the stack name first. CloudFront takes a few minutes to delete.

## What it costs

A small setup costs a dollar or two a month, mostly two secrets. See [Cost](/cost) for the arithmetic.
