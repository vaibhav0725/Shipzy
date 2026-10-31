---
title: Getting started
description: Install shipzy, connect your AWS account, and put your first site live.
section: Start
order: 1
---

shipzy deploys React and Next.js sites to **your own AWS account**. This guide takes you from nothing to a live site in about ten minutes, most of it waiting for AWS the first time.

## What you need

- An **AWS account**, and an IAM user or SSO profile you can use from the command line. Do not use root access keys.
- **Node.js 20 or newer**, and git.
- A **React project** built with Vite or Create React App, or a **Next.js project set up for a static export** (see [Next.js](/docs/nextjs)).

## 1. Install the CLI

shipzy is in **beta**, so the install command names the `beta` tag. It works end to end, but read [limits and roadmap](/docs/limits) before you rely on it.

```sh
npm install -g shipzy@beta
shipzy --version
```

## 2. Point it at your AWS account

shipzy uses your normal AWS profile, the same one the AWS CLI uses. Nothing is stored by shipzy.

```sh
export AWS_PROFILE=my-profile   # a profile from `aws configure`
shipzy status                   # who you are in AWS
```

> **Safer than an administrator key.** shipzy publishes an IAM policy that allows only what it needs, and a script that creates a user with it. See [AWS setup](/docs/aws-setup).

## 3. Create the infrastructure

```sh
shipzy init
```

This creates the buckets, the CDN, the build project and the two small functions in your account. It takes about **five minutes the first time**, because CloudFront is slow to create. It prints the bucket, the default URL and the webhook URL when it is done, and it is safe to run again.

The default region is `us-east-1`. Use `--region` to choose another.

## 4. Deploy your first site

```sh
shipzy deploy ./my-app --project my-app
```

shipzy detects the framework, builds the project on your machine, uploads it, and prints the address:

```text
› Deploying my-app (Vite) from my-app/dist
› Uploaded 8 files as d-20261031T130907-a6373d

✔ Live: https://d1a2b3c4d5e6f7.cloudfront.net
(Routing changes propagate to the edge in roughly 30 seconds.)
```

The **first deploy of a project takes about five minutes longer**, because it creates the project's own CloudFront address. Later deploys of the same project are fast.

## 5. Change something, then go back

```sh
shipzy deploy ./my-app --project my-app     # a new version goes live
shipzy list -p my-app                       # every version, and which one is live
shipzy rollback -p my-app                   # point the site back at the previous one
```

Every deploy is an immutable copy, so rolling back is instant and never needs a rebuild.

## Open the dashboard (optional)

```sh
shipzy dashboard
```

The first time, it asks whether to download the dashboard (about 16 MB). To look around without an AWS account, run `shipzy dashboard --demo`. See the [dashboard guide](/docs/dashboard).

## Where next

- Deploy on every push to GitHub: [Deploying](/docs/deploying)
- Serve it on your own domain: [Domains](/docs/domains)
- Give builds environment variables: [Environment variables](/docs/env-vars)
- Preview every pull request: [Previews](/docs/previews)
- Deploy a Next.js site: [Next.js](/docs/nextjs)
