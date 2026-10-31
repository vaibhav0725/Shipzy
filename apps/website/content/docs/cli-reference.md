---
title: CLI reference
description: Every command and option, with the global options, colours and environment variables.
section: Reference
order: 1
---

Run `shipzy --help`, or `shipzy <command> --help`, for the same information in your terminal.

## Global options

Accepted by every command, before the command name:

| Option | Meaning |
|---|---|
| `--profile <name>` | AWS profile to use (or set `AWS_PROFILE`) |
| `--region <region>` | AWS region (default: `AWS_REGION`, else `us-east-1`) |
| `--stack-name <name>` | Which stack to operate on (default: `Deployer`) |

## Colours and plain output

On a terminal shipzy colours its output: green for success and healthy status, red for errors, yellow for warnings and things in progress, bold for names, and underlined cyan for addresses you can open. Long waits show a spinner with a timer. Colour turns itself off when output is piped, in CI, and with `--json`. Set `NO_COLOR=1` to switch it off, or `FORCE_COLOR=1` to keep it on in a pipe. It uses your terminal's own 16 colours, so it follows a light or dark theme.

## `init`

Creates or updates the stack, uploads the engine code and build script, and installs them. Safe to rerun. If a first attempt failed and rolled back, `init` removes the failed stack and retries.

| Option | Meaning |
|---|---|
| `--budget <usd>` | Email me when the month is heading past this amount. `off` removes the alert |
| `--budget-email <email>` | Where the alert goes (asked for if you leave it out) |

The first time you run `init` in a terminal it offers a spending alert; press Enter to skip. The alert is an AWS Budget for the whole account that emails at 80% and 100% of the amount and when AWS forecasts you will pass it. AWS has no spending cap, so it warns and does not stop anything. Later runs keep it as it is unless you pass `--budget` again.

## `deploy [dir]`

| Option | Meaning |
|---|---|
| `-p, --project <name>` | Project name (default: from `package.json`) |
| `--repo <owner/name>` | Deploy a GitHub repository instead of a folder (built in AWS; public repositories need no token) |
| `--branch <name>` | With `--repo`: the branch to deploy (default: the repository's default branch) |
| `--host <hostname>` | Host to serve on (default: the project's domains and its own address) |
| `--skip-build` | Upload the existing `dist/`, `build/` or `out/` as it is (local only) |
| `--remote` | Build in CodeBuild in your account instead of on this machine |
| `--detach` | With `--remote`: start the build and return without waiting |
| `--install-command <cmd>` | Replace the install step |
| `--build-command <cmd>` | Replace the build step |
| `--keep <n>` | Deploys to retain per project (live ones are always kept). Default 10 |

## `list` (alias `ls`)

No options: a table of all projects. `-p, --project <name>` lists one project's deploys. `--json` for scripts.

## `status`

The account, region, stack state, bucket, CloudFront URL, build setup, webhook URL, number of GitHub-connected projects, the last build, and totals. `--json` for scripts.

## `cost`

What this month is costing, from CloudWatch usage and AWS list prices: CloudFront traffic, the router, S3 storage, CodeBuild minutes and Secrets Manager, with the cost so far, a projection for the whole month, and traffic by address. `--json` for scripts.

It is an estimate. It uses US and Europe rates, assumes the free allowances are unused by anything else in the account, and leaves out Route 53 zones. CloudFront metrics arrive a few minutes late. AWS Billing is the exact figure. It needs the `UsageMetrics` part of the [published policy](/docs/aws-setup).

## `builds`

| Option | Meaning |
|---|---|
| `-p, --project <name>` | Only builds of this project |
| `--limit <n>` | How many to show (default 10) |
| `--json` | Machine-readable output |

## `logs <build>`

Prints a remote build's log. `<build>` is the short id shown by `builds`. `-f, --follow` keeps streaming until the build finishes. The exit code is 1 if the build did not succeed.

## `rollback`

| Option | Meaning |
|---|---|
| `-p, --project <name>` | Project (required) |
| `--to <deploymentId>` | Deploy to serve (default: the one before the live one) |
| `--host <hostname>` | Host to roll back (default: all hosts the project is live on, together) |

## `prune`

| Option | Meaning |
|---|---|
| `-p, --project <name>` | Project (required) |
| `--keep <n>` | Newest deploys to retain (live ones always kept). Default 10 |
| `--grace-minutes <n>` | Leave unrecorded uploads newer than this alone. Default 60 |
| `--dry-run` | Show what would be deleted |

## `delete` (alias `rm`)

`-p, --project <name>` (required), `-y, --yes` to skip the confirmation, `--dry-run` to preview.

## `destroy`

Removes GitHub webhooks, custom domains and project addresses, empties both buckets and deletes the stack. `-y, --yes` skips the confirmation.

## `dashboard`

| Option | Meaning |
|---|---|
| `--port <number>` | Port to listen on (default 4173; `127.0.0.1` only) |
| `--no-open` | Print the address without opening the browser |
| `--install` | Download or update the optional dashboard first, without asking |
| `--demo` | Run on sample data, without reading or changing anything in AWS |

## `domain`

| Command | Options | What it does |
|---|---|---|
| `domain add <host>` | `-p, --project`, `--preview`, `--manual`, `--no-wait` | Creates the certificate and distribution, and the DNS records when a Route 53 zone exists. Rerun to continue |
| `domain ls` | `--json`, `-p` | Hosts with project, stack status, certificate status and whether DNS reaches the distribution |
| `domain verify <host>` | | Checks the stack, certificate, project claim and DNS |
| `domain rm <host>` | `-y, --yes` | Removes the route, distribution stack and certificate, and only the DNS records shipzy created |

`--preview` makes a wildcard domain (for example `"*.preview.example.com"`) that serves pull request previews, instead of belonging to one project. `--manual` prints the DNS records instead of creating them.

## `env`

| Command | Options | What it does |
|---|---|---|
| `env set <name> [value]` | `-p, --project`, `--preview` | Sets a variable. Also accepts `NAME=value`, or reads the value from stdin or a hidden prompt |
| `env import <file>` | `-p, --project`, `--preview` | Sets every variable in a `.env` file (all or nothing) |
| `env ls` | `-p, --project`, `--json` | Lists names and which scopes have a value; values are never shown |
| `env rm <name>` | `-p, --project`, `--preview` | Removes a variable |

## `previews`

`shipzy previews [-p <project>] [--json]` lists the preview domain and the open previews. `shipzy previews rm <pr> -p <project>` takes one down.

## `github`

| Command | Options | What it does |
|---|---|---|
| `github connect` | `-p, --project`, `--repo <owner/name>`, `--branch`, `--host`, `--install-command`, `--build-command`, `--reuse-token`, `--previews` | Validates the token, stores it, registers the webhook (push events, plus pull request events with `--previews`) and saves the connection |
| `github deploy` | `-p, --project`, `--detach` | Builds the current head of the connected branch now |
| `github disconnect` | `-p, --project` | Stops deploying from GitHub. The webhook is removed with the last project on a repository |
| `github rotate-secret` | | Replaces the webhook's signing secret and updates the webhook on every connected repository |

## Environment variables

| Variable | Meaning |
|---|---|
| `AWS_PROFILE`, `AWS_REGION` | Which credentials and region to use |
| `GITHUB_TOKEN` | A GitHub token for `github connect`, instead of the hidden prompt |
| `NO_COLOR`, `FORCE_COLOR` | Switch colour off, or force it on |
| `SHIPZY_GITHUB_CLIENT_ID` | A GitHub OAuth App client ID for the dashboard's "Connect GitHub" (it can also be saved from the dashboard) |

## Exit codes

`0` on success and `1` on any error, with the reason printed on standard error. `logs` also exits `1` when the build it shows did not succeed.
