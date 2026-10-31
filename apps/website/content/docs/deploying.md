---
title: Deploying
description: Deploy from a folder, from AWS, or from GitHub, and control where the site is served.
section: Guides
order: 1
---

There are three ways to start a deploy. They all produce the same thing: a new immutable copy of the site, made live.

## From a folder on your machine

```sh
shipzy deploy ./my-app --project my-app
```

shipzy installs dependencies, builds, uploads the output and makes it live.

- `--project` defaults to the `name` in `package.json`. Names use lowercase letters, digits and dashes.
- `--skip-build` uploads an existing `dist/`, `build/` or `out/` folder as it is.
- `--install-command` and `--build-command` replace the detected steps, for example `--install-command "npm ci --legacy-peer-deps"`.
- `--keep 20` keeps more history than the default 10. Live deploys are always kept.

shipzy detects the package manager from the lockfile (`pnpm-lock.yaml`, `yarn.lock` or `package-lock.json`) and runs `<package manager> run build`.

### What is supported

| Project | Output folder |
|---|---|
| Vite | `dist/` |
| Create React App | `build/` |
| Next.js with `output: 'export'` | `out/` (see [Next.js](/docs/nextjs)) |

The project needs a `react` dependency and a `build` script, and routes must work from the site root. A Vite `base` or a CRA `homepage` pointing at a sub-path will break asset loading.

## In your AWS account (`--remote`)

```sh
shipzy deploy ./my-app --project my-app --remote            # build in AWS and watch the log
shipzy deploy ./my-app --project my-app --remote --detach   # start it and come back later
shipzy builds -p my-app                                     # recent builds and their status
shipzy logs <build> -f                                      # follow a running build
```

The build runs in CodeBuild in your account, using the project's stored [environment variables](/docs/env-vars). It spends about 1.5 minutes starting up, so a local deploy is the fast choice while you iterate. Press Ctrl-C to stop *watching*; the build keeps running.

Remote deploys never upload `node_modules`, `dist`, `build`, `.git` or any `.env*` file.

## From GitHub

### Deploy a repository once

```sh
shipzy deploy --repo owner/name
shipzy deploy --repo https://github.com/owner/name --branch main
```

The build runs in your account. A public repository needs no token.

### Deploy on every push

Connect the repository once per project:

1. Create a **fine-grained personal access token** limited to the repository, with **Contents: Read-only** and **Webhooks: Read and write**.
2. Connect it:

   ```sh
   shipzy github connect -p my-app --repo owner/name
   ```

   Paste the token when asked (the input is hidden), or set `GITHUB_TOKEN`. The token is checked against the repository and stored in your account's Secrets Manager, and the webhook is registered on the repository.

From then on, every push to the connected branch builds and deploys. You can also build the current head without pushing:

```sh
shipzy github deploy -p my-app
```

Useful options for `github connect`: `--branch`, `--host`, `--install-command`, `--build-command`, `--previews` (see [Previews](/docs/previews)) and `--reuse-token` (use the token already stored). Several projects can follow one repository, each on its own branch or host. To stop: `shipzy github disconnect -p my-app`.

## Where the site is served

- **A project's own address.** The first deploy of a project with no domain creates a small CloudFront distribution and gives it an address like `d1a2b3c4d5e6f7.cloudfront.net`. Every later deploy of that project updates the same address, and other projects have theirs, so any number of sites can be live at once.
- **A custom domain.** Once you [add one](/docs/domains), deploys update it (and the project's own address).
- **`--host`.** Serve on a specific hostname that already points at your stack.

A first deploy takes about five minutes longer while CloudFront creates the address. After that, deploys are as fast as the build.

## Retention

shipzy keeps the newest 10 deploys of each project, plus any that are live, and removes older ones automatically. See [Rollback and cleanup](/docs/rollback-cleanup).
