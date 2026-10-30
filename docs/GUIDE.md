# deployer: the complete guide

An open-source, bring-your-own-AWS deployer for static React apps. You point a command-line tool at **your own AWS
account**, and it publishes React projects there: files in S3, served worldwide by CloudFront, with instant rollback,
builds that can run in your account, and automatic deploys when you push to GitHub.

`deployer` is a working name. Nothing here runs on a server we operate: the only software outside your AWS account is
the CLI on your machine.

**Contents**

1. [What it is, and what it is not](#1-what-it-is-and-what-it-is-not)
2. [How it works](#2-how-it-works)
3. [Features](#3-features)
4. [Getting started](#4-getting-started)
5. [Using it day to day](#5-using-it-day-to-day)
6. [Command reference](#6-command-reference)
7. [What your project needs](#7-what-your-project-needs)
8. [What gets created in your AWS account](#8-what-gets-created-in-your-aws-account)
9. [Security model](#9-security-model)
10. [Limits and known issues](#10-limits-and-known-issues)
11. [Troubleshooting](#11-troubleshooting)
12. [The repository, and working on it](#12-the-repository-and-working-on-it)
13. [Status and roadmap](#13-status-and-roadmap)

---

## 1. What it is, and what it is not

**It is** a tool that deploys static React apps (Vite or Create React App) to infrastructure you own:

- You keep your AWS bill, your data and your credentials. The tool is a thin layer of code and AWS resources.
- A deploy produces an immutable copy of your site. Going live, and going back, is a single small update.
- You can build on your own machine (fast) or inside your AWS account (reproducible, and needed for GitHub).

**It is not (yet)**: a hosted service, a dashboard you can open from anywhere (there is a local one, section 5.10), or a Next.js host. See
[section 13](#13-status-and-roadmap).

---

## 2. How it works

### 2.1 The big picture

```
 YOUR MACHINE                          YOUR AWS ACCOUNT
 ────────────                          ────────────────────────────────────────────────────────────

                                       ┌──────────────┐      ┌───────────────────────────────┐
 deployer CLI ── local deploy ───────▶ │ S3 "sites"   │ ◀──┐ │ CloudFront                    │ ◀── visitors
   │                                   │ <project>/   │    │ │  router function              │
   │  --remote: zip source             │  <deploy-id>/│    └─│  (reads the routing table,    │
   ├──────────────▶ S3 "builds" ──┐    └──────────────┘      │   rewrites the path)          │
   │                              ▼          ▲               └───────────────▲───────────────┘
   │  start build           ┌───────────┐    │ upload dist/                  │ host → deployment
   └──────────────────────▶ │ CodeBuild │ ───┘                               │
                            └─────┬─────┘                            ┌───────┴────────┐
 GitHub push ─▶ Webhook Lambda ───┘ start build                      │ KeyValueStore  │
  (signature checked)                                                │ (routing table)│
                                  CodeBuild ─▶ Engine Lambda ──────▶ └────────────────┘
                                               "promote": set route, record history, prune
```

### 2.2 The three ideas everything is built on

**1. Every deploy is an immutable folder.** A deployment is stored at `s3://<sites-bucket>/<project>/<deployment-id>/`,
and is never edited afterwards. Deployment ids look like `d-20261029T104746-19fff9` (a UTC timestamp and a random
suffix).

**2. One small table decides what is live.** A CloudFront *KeyValueStore* maps a hostname to a deployment:
`host:<hostname>` → `<project>/<deployment-id>`. Making a deployment live is writing one entry. Rolling back is
writing a different one. No files are copied and the CloudFront distribution is not touched.

**3. A router function does the lookup on every request.** A small CloudFront Function reads the table, then rewrites
the request path so S3 serves the right folder.

### 2.3 What happens to a visitor's request

1. The browser asks for `/about` on your site's hostname.
2. The router function looks up the hostname in the routing table, for example `demo/d-20261028T213343-f4abfb`.
3. It rewrites the path to point inside that folder. A path whose last segment has no `.` (such as `/about`, or `/`)
   becomes `/index.html`, so client-side routes such as React Router's `BrowserRouter` work on a page refresh.
   A path with an extension (`/assets/app.js`) is a real file and is kept.
4. CloudFront checks its cache, keyed by the **rewritten** path. A hit is served immediately. On a miss, it reads the
   file from the private S3 bucket (through an Origin Access Control, so the bucket is never public).
5. If no deployment is live for that hostname, the function returns a plain-text 404.

Because the cache key contains the deployment id, a rollback can never serve stale files from the other version.

### 2.4 Three ways to start a deploy

| | Where the build runs | Who finishes the job |
|---|---|---|
| `deploy <dir>` (local) | Your machine, with your Node and package manager | The CLI uploads, sets the route, records history, prunes |
| `deploy <dir> --remote` | CodeBuild in your account | The **engine** Lambda |
| A push to a connected GitHub branch | CodeBuild in your account | The **engine** Lambda |

**Local deploy.** Detects the package manager, installs, runs `build`, finds `dist/` or `build/`, uploads it as a new
folder, sets the route, records the deployment, and prunes old ones.

**Remote deploy.** Zips your source, uploads the zip to the *builds* bucket, and starts a CodeBuild build. The build
unzips it, installs, builds, uploads the output, and calls the engine to promote it. The CLI streams the log to your
terminal.

**GitHub deploy.** A push reaches the **webhook** Lambda. It checks GitHub's signature, finds the projects connected
to that repository and branch, and starts a build for each, from that exact commit. From there it is the same as a
remote deploy.

The engine does exactly what the local CLI does after a build: set the route, record the deployment, prune. They share
the same code (`packages/core`).

### 2.5 What a deploy guarantees

- **Nothing changes until the very end.** A new folder is fully uploaded before any route moves.
- **A failed build changes nothing.** The route is untouched. A partial upload is removed, unless the route already
  points at it (then deleting would take a live site down, so it is left alone).
- **Concurrent deploys are safe.** Both the history file (S3 conditional writes) and the routing table (re-read and
  retry on conflict) are written with optimistic locking, so simultaneous deploys or builds do not lose updates.
- **Storage stays bounded.** After each deploy, only the newest 10 deployments are kept (plus anything a host routes
  to). Uploads that never completed are swept up after a one-hour grace period.

### 2.6 Where state lives

| State | Where |
|---|---|
| The site files | `s3://<sites>/<project>/<deployment-id>/…` |
| Which deployment is live for a host | The KeyValueStore: `host:<hostname>` → `<project>/<id>` |
| Deployment history, and a project's GitHub connection | `s3://<sites>/.deployer/<project>.json` |
| Uploaded sources for remote builds (deleted after 7 days) | `s3://<builds>/src/<project>/<id>.zip` |
| The engine code and the build script | `s3://<builds>/engine/…` and `scripts/build.sh` |
| GitHub token and webhook signing secret | AWS Secrets Manager (two secrets) |

There is no database. The routing table is the source of truth for what visitors see; the history file is the source
of truth for what can be rolled back to.

---

## 3. Features

**Deploying**
- Local deploys of Vite and Create React App projects; automatic package-manager detection (npm, pnpm, yarn).
- Remote builds in CodeBuild in your own account, with the log streamed to your terminal.
- Automatic deploys on `git push`, per project, per branch.
- Override the install or build step (for example `--install-command "npm ci --legacy-peer-deps"`).
- Build-time environment variables for remote and GitHub builds, stored encrypted in your account, with separate
  production and preview values.

**Domains**
- Your own hostnames with HTTPS (`domain add`): certificate, CloudFront distribution and, if the domain is in Route 53,
  the DNS records, all created for you. Any other DNS provider works too (you add the printed records).
- Several projects side by side, each on its own hostname; one project on several hostnames.

**Dashboard**
- `deployer dashboard` opens a web UI on your own computer: deploy from a folder or a GitHub repository, then roll
  back, manage domains and variables, and follow build logs live. It runs the same CLI underneath.

**Operating**
- Instant rollback to the previous deployment, or to any recorded one.
- `list` and `status` for an overview of projects, what is live where, sizes, and the last build; `--json` for scripts.
- `builds` and `logs` for remote builds, including following a running build and cancelling the watch with Ctrl-C.
- Retention and cleanup: automatic pruning, a manual `prune` with a dry run, and removal of single projects.

**Safety**
- Immutable deployments; failed deploys clean up after themselves; safe under concurrent deploys.
- Scoped IAM roles, a signature-checked webhook, secrets in Secrets Manager, no stored long-lived keys.
- Confirmation prompts for destructive commands, and `--dry-run` where it matters.

**Infrastructure**
- One CloudFormation stack created by `init`; safe to rerun; no `cdk bootstrap` needed.
- Several independent stacks in one account (`--stack-name`), for example staging.
- `destroy` removes everything, including GitHub webhooks.

---

## 4. Getting started

### 4.1 What you need

- An AWS account, and permission to create the resources listed in [section 8](#8-what-gets-created-in-your-aws-account).
  During development an IAM user with `AdministratorAccess` was used.
- **Do not use root access keys.** Create an IAM user (or an SSO profile) and give it a named AWS CLI profile.
- Node.js 20 or newer, and git.
- The AWS CLI is not required by the tool, but is handy for checking things.

### 4.2 One-time setup

```sh
cd /path/to/this/repo
npm install
npm run build          # builds core, the engine zip, the CloudFormation template and the single-file CLI
cd apps/cli && npm link && cd ../..   # installs a real `deployer` command on your PATH
export AWS_PROFILE=<your-profile>
deployer --version
```

`npm link` makes `deployer` available from any directory, and rebuilding with `npm run build` updates it. To remove it,
run `npm unlink -g @deployer/cli`. Inside the repository you can also run it as `npm run deployer -- <command>`.

**Installing without the repository.** `npm pack` in `apps/cli` produces a ~0.8 MB tarball that installs with
`npm install -g <tarball>` and has no dependencies: the CLI, the stack template, the Lambda code and the build script
are all inside it. It has been tested from a clean install. The package is marked `private` for now, because the final
package name has not been chosen; once it is, removing that flag and running `npm publish` makes
`npm install -g <name>` work for anyone.

#### Least-privilege access (recommended)

An administrator key works but is far more than this tool needs. `docs/iam/` has a policy that allows only what
`deployer` does, and a script that creates a user with it:

```sh
AWS_PROFILE=<your-admin-profile> bash docs/iam/create-limited-user.sh     # creates user "deployer-cli", writes profile "deployer-lp"
AWS_PROFILE=deployer-lp deployer status
```

The key is written straight into your local AWS profile and never printed. What the policy allows, by name:

- the CloudFormation stacks, S3 buckets, Lambda functions and IAM roles whose names start with `Deployer`;
- CloudFront, CodeBuild, ACM, Route 53 records, and the `/deployer/` parameters and the stack's two secrets;
- nothing else: not other buckets, not other IAM users or access keys, not other services.

If you use a different stack name (`--stack-name Staging`), replace the `Deployer` prefix in the policy with it.
The policy can create IAM roles named `Deployer*`; it cannot create users, access keys or attach anything other than the
Lambda logging policy. A person holding it could still give such a role extra rights through an inline policy, so treat
the key as sensitive and do not share it.

### 4.3 Create the infrastructure

```sh
deployer init
```

This takes about 5 minutes the first time (CloudFront is slow to create). It prints the bucket, distribution, default
URL, build project and webhook URL. It is safe to run again: it only changes what has changed, and prints
"Already up to date." when nothing has.

The default region is `us-east-1`. Use `--region` to change it.

### 4.4 Your first deploy

```sh
deployer deploy ./my-react-app --project my-app
```

When it finishes it prints the live URL (the CloudFront domain). Changes reach every CloudFront location in about
30 seconds.

---

## 5. Using it day to day

### 5.1 Deploy from your machine

```sh
deployer deploy ./my-react-app --project my-app
```

- `--project` defaults to the `name` in `package.json`.
- `--skip-build` uploads an existing `dist/` or `build/` as it is.
- `--keep 20` keeps more history than the default 10.

### 5.2 Deploy from AWS instead

```sh
deployer deploy ./my-react-app --project my-app --remote          # watch the log
deployer deploy ./my-react-app --project my-app --remote --detach # start it and come back later
deployer builds -p my-app                                         # recent builds and their status
deployer logs <build> -f                                          # follow a running build
```

A remote build spends about 1.5 minutes in CodeBuild startup before your own build begins, so a local deploy is the
fast choice while iterating. Ctrl-C stops *watching* a build; the build keeps running.

### 5.3 Deploy on every push to GitHub

One time per project:

1. Create a **fine-grained personal access token** at <https://github.com/settings/personal-access-tokens/new>,
   limited to the repository, with **Contents: Read-only** and **Webhooks: Read and write**.
2. Run:
   ```sh
   deployer github connect -p my-app --repo owner/name
   ```
   Paste the token when asked (the input is hidden), or set `GITHUB_TOKEN` in the environment. The token is checked
   against the repository, stored in your account's Secrets Manager, and the webhook is registered on the repository.
   The connection (repository, branch, host and any build overrides) is saved on the project.

After that, every push to the connected branch builds and deploys. You can also build the branch's current head
without pushing:

```sh
deployer github deploy -p my-app
```

See [`github`](#github-connect-deploy-disconnect-rotate-secret) in the reference for options, including deploying a
different branch, a custom host, and several projects from one repository.

#### Pull request previews

Each open pull request can get its own address, such as `my-app-pr-12.preview.example.com`, rebuilt on every push
and removed when the pull request closes. A comment with the link is kept up to date on the pull request.

One time per stack, add a **wildcard preview domain** (it serves the previews of every project; it has its own
certificate and distribution, like a custom domain, and the same Route 53 / manual DNS rules apply):

```sh
deployer domain add "*.preview.example.com" --preview
```

One time per project, connect it to GitHub with previews on (and give the token **Pull requests: Read and write**,
so the comment can be posted):

```sh
deployer github connect -p my-app --repo owner/name --previews --reuse-token
```

Then open a pull request into the connected branch. See what exists with `deployer previews`, or remove one by hand
with `deployer previews rm -p my-app 12`.

How it behaves:

- Only pull requests from a branch **of the same repository** are built. A fork's code is never run, because a build
  receives the project's variables.
- A preview build gets the project's production variables with any `--preview` values laid over them (section 5.4).
- Before a preview goes live the engine asks GitHub whether the pull request is still open and still at that commit,
  so a late or superseded build never goes live and a closed pull request is never revived.
- A failed preview build comments on the pull request; the previous preview, if any, keeps being served.
- Previews never count towards the newest-10 retention of production deployments, and are never touched by
  `rollback`. Only the newest build of each pull request is kept.
- Removing the preview domain (`deployer domain rm "*.preview.example.com"`) removes every preview on it.

### 5.4 Environment variables for remote and GitHub builds

Local deploys read your local `.env` as always. Remote and GitHub builds run in AWS and never receive `.env` files, so
their build-time variables are stored with `deployer env`, encrypted in your account (AWS Systems Manager Parameter
Store, SecureString):

```sh
deployer env set -p my-app VITE_API_URL https://api.example.com
deployer env set -p my-app API_KEY             # no value given: type it (hidden) or pipe it in
deployer env import -p my-app .env             # set every variable in a .env file
deployer env ls -p my-app                      # names and scopes; values are never shown
deployer env rm -p my-app VITE_API_URL
```

- A change applies to the **next build**, not to what is live now. Redeploy with `deploy --remote` or `github deploy`.
- `--preview` stores a value used only by preview builds. A preview build gets the production values with any
  preview values laid over them, so a preview only needs to list what differs.
- Names starting `DEPLOY_`, `SOURCE_`, `AWS_` or `CODEBUILD_`, and a few build-system names, are reserved. Values
  cannot be empty and are limited to 4096 bytes. `import` checks the whole file first and writes nothing if any line is
  invalid.
- **These end up in your built JavaScript** if your framework exposes them to the browser (Vite exposes only `VITE_*`,
  Create React App only `REACT_APP_*`). Use them for public configuration, not secrets. Other variables are visible to
  the build process only. CodeBuild masks injected values in logs, and the build's metadata lists only the parameter
  paths.

### 5.5 Custom domains

By default every project is served at the stack's CloudFront URL, so the **last project deployed there wins**. Give each
project its own hostname instead:

```sh
deployer domain add app.example.com -p my-app     # certificate + distribution + DNS (about 5 to 15 minutes)
deployer domain ls                                # hosts, project, stack, certificate and DNS state
deployer domain verify app.example.com            # re-check everything; safe to run any time
deployer domain rm app.example.com                # remove it completely (asks to confirm)
```

`domain add` does this, and can be rerun at any point to continue where it stopped:

1. Looks for a **Route 53 hosted zone** in your account that covers the hostname (the longest matching suffix).
   - **Zone found:** every DNS record is created for you, and `domain rm` removes the ones it created.
   - **No zone, or `--manual`:** the exact records are printed and the command waits. Add them wherever your DNS is
     hosted. There are two: a validation CNAME for the certificate (keep it, since the certificate renews through
     it) and a CNAME from your hostname to the CloudFront domain it prints.
2. Requests a free **ACM certificate** in `us-east-1` (CloudFront requires that region whatever your stack's region is).
3. Creates a small CloudFormation stack, `<stack>-domain-<hostname>`, holding one CloudFront distribution that reuses
   the main stack's router, routing table and bucket access. Your main distribution is never touched.
4. Records the hostname on the project and routes it to the project's live deployment.

**Which hosts does a deploy update?** `--host` if you pass it; otherwise all of the project's domains; otherwise the
CloudFront URL. A project with domains keeps updating the CloudFront URL only while it already owns that route, so a
project never takes over another project's default URL by accident. Rollback moves the same set together.

**Using a domain you own elsewhere (GoDaddy, Namecheap and so on).** Pick a subdomain and **delegate** it to Route 53
so the whole thing is automatic:

1. In Route 53 create a hosted zone for the subdomain, for example `apps.example.com`. It shows four name servers.
2. At your registrar add four `NS` records named `apps` (the subdomain part only) with those four values.
3. Check with `dig NS apps.example.com @8.8.8.8`. Then `domain add blog.apps.example.com -p blog` just works.

Your main site on `example.com` is unaffected. If you would rather not delegate, use `--manual`. **A bare domain
(`example.com`) cannot be a CNAME**, which is what most registrars offer, so use a subdomain (`www.example.com`) or move
the domain's DNS to Route 53.

**Good to know**
- A hostname can belong to only one CloudFront distribution in the world. If it already does (for example on an old
  site), `domain add` stops with a message saying so; remove it from that distribution first.
- Each domain is one distribution (default quota 500 per account) and one certificate. Certificates are free.
- Route 53 charges about $0.50 a month per hosted zone; the CloudFront distribution itself costs nothing when idle.

### 5.6 Roll back

```sh
deployer list -p my-app               # shows deployment ids and which is live
deployer rollback -p my-app           # back to the previous deployment
deployer rollback -p my-app --to d-20261029T104026-4dc09a   # or to a specific one
```

It takes effect in about 30 seconds. Only recorded deployments can be rolled back to, and only the newest 10 are kept
by default.

### 5.7 See what you have

```sh
deployer status        # account, stack, URL, build setup, last build, totals
deployer list          # every project: where it is live, how old, auto-deploy source, versions, size
deployer list -p my-app
```

### 5.8 Clean up

```sh
deployer prune -p my-app --dry-run    # see what would be deleted
deployer prune -p my-app
deployer delete -p my-app             # remove a project completely (asks you to type its name)
deployer destroy                      # remove the entire stack (asks you to type the stack name)
```

`delete` removes the project's routes, every deployment folder, its uploaded sources, its environment variables, its custom
domains, its pull request previews and its GitHub webhook. If the project is live, that site starts returning 404 until
something else is deployed.

`destroy` removes the custom domains and the preview domain first (each one's distribution, certificate and the DNS
records this tool made), then the webhooks, variables and buckets, then the stack. If a domain cannot be removed it stops
**before** deleting anything else and tells you which one; fix it (or run `deployer domain rm <host>`) and run `destroy`
again. A `destroy` that was interrupted can be run again: it picks up where it stopped, and `domain rm` also works on a
stack left in `DELETE_FAILED`.

### 5.9 More than one stack

`--stack-name` makes an independent copy in the same account, for example a staging environment:

```sh
deployer --stack-name Staging init
deployer --stack-name Staging deploy ./my-react-app
```

### 5.10 The local dashboard

```sh
deployer dashboard                # starts it and opens your browser
deployer dashboard --port 4300 --no-open
```

A web UI for everything above, started from a terminal and reachable **only from your own computer**
(`127.0.0.1`). It uses the same AWS profile, region and stack as the CLI (`--profile`, `--region`, `--stack-name` work
before `dashboard`). Press Ctrl-C in the terminal to stop it.

| Screen | What you do there |
|---|---|
| Overview | Account, stack, shared URL, totals, last build. If the stack does not exist it tells you to run `deployer init` |
| Projects | Every project: where it is live, age, auto-deploy source, versions, size |
| New deployment | Deploy from **a folder on this computer** (type or browse to it; build here or in AWS) or from **a GitHub repository** (pick from your repositories after **Connect GitHub**, or paste a link; token from the login, pasted, or the stored one) |
| Project: Deployments | History with live badges, "Serve this one" (rollback), preview and run cleanup, delete the project |
| Project: Domains | Add (progress shown live), check and remove custom domains |
| Project: Environment | Add or remove variables, import a pasted `.env`; values are never shown |
| Project: GitHub | The connection, "build the current head now", disconnect |
| Project: Builds | Recent builds in AWS and their logs |
| Activity | Everything started from the dashboard, with its full output |

**How it works.** The dashboard is a Next.js app shipped inside the CLI package. Reading data and every action run the
`deployer` command itself (with `--json` for reads), so behaviour is identical to the terminal and nothing is
re-implemented. Actions run as background jobs; their output streams to the browser live and is kept in memory while
the dashboard runs. Closing the browser tab does not stop a job; stopping the dashboard does (a build already started
in AWS keeps running there).

**Safety.**
- It listens on `127.0.0.1` only. Each run has a random token in the address it prints; opening that address signs the
  browser in with a cookie that lasts until you stop the dashboard. Requests need that cookie, a `Host` header that
  names the local server, and (for changes) a matching `Origin`, so another website you visit cannot drive it.
- Every value from the browser is validated before it becomes a command-line argument, and arguments are passed as a
  list, never through a shell.
- Secrets (a GitHub token, a variable's value) travel through the environment or standard input, never on a command
  line, and are blanked out of job logs. No page or API ever returns them. Child processes do not receive the
  dashboard's own token.
- Deploying without a hostname to a project that has no domains asks you to agree that it **replaces whatever is
  live at the shared CloudFront address**.
- Cancelling a job stops the local process. If the build had already started in AWS, it finishes anyway.

#### Connect GitHub (sign in instead of pasting a token)

With a GitHub login set up, **New deployment → GitHub repository** shows a **Connect GitHub** button. It shows a short
code, you approve it on github.com, and the dashboard then lists your repositories to pick from (private ones too).
Connecting a repository for deploy-on-push needs no token to be typed.

One-time setup (about two minutes, free). Until it is done, the page shows these steps and a box for the result:

1. On github.com open **Settings → Developer settings → OAuth Apps → New OAuth App**
   (direct link: `github.com/settings/applications/new`).
2. Name: anything (for example `Deployer`). Homepage URL and Authorization callback URL: `http://127.0.0.1`.
3. Register it, then tick **Enable Device Flow** and save. Do **not** generate a client secret; it is not needed.
4. Copy the **Client ID** (it is not a secret) and paste it into the box on the page, then **Save**. It is remembered in
   `~/.deployer/dashboard.json`, so this is done once. (Setting `DEPLOYER_GITHUB_CLIENT_ID` in the environment works too
   and takes precedence.)

What it does with the login:
- The token GitHub returns is kept **in the memory of the running dashboard only**: not written to disk, not sent to the
  browser, gone when you stop the dashboard or press **Disconnect**.
- When you connect a repository, the token is handed to the CLI through an environment variable and stored encrypted in
  **your** AWS account (the same place as a pasted token), because the build and the webhook need it later.
- It asks GitHub for the `repo` scope: read your repositories and manage their webhooks and pull request comments. That
  is broader than a fine-grained token limited to one repository; if you prefer that, paste a token instead.
- Repositories in an organization may need the organization's approval for the OAuth App (GitHub shows a request
  button on the approval page). To revoke access later: github.com → Settings → Applications.
- You need admin rights on a repository for its webhook to be created; otherwise the first deploy works but pushes will
  not redeploy.

Without the client ID the page falls back to pasting a token, as before.

**Limits.** `init` and `destroy` stay terminal-only on purpose. The dashboard is a local tool: anyone who can use your
computer's browser session and reach `127.0.0.1` while it runs has your AWS access through it, so stop it when you are
done. A hosted or self-hosted dashboard for teams is a later step.

---

## 6. Command reference

Global options, accepted by every command:

| Option | Meaning |
|---|---|
| `--profile <name>` | AWS profile to use (or set `AWS_PROFILE`) |
| `--region <region>` | AWS region (default: `AWS_REGION`, else `us-east-1`) |
| `--stack-name <name>` | Which stack to operate on (default: `Deployer`) |

### `init`
Creates or updates the stack, uploads the engine code and build script, and installs them. Safe to rerun.
If a first attempt failed and rolled back, `init` removes the failed stack and retries.

### `deploy <dir>`
| Option | Meaning |
|---|---|
| `-p, --project <name>` | Project name (default: from `package.json`) |
| `--host <hostname>` | Host to serve on (default: the project's domains, else the CloudFront domain) |
| `--skip-build` | Upload the existing `dist/` or `build/` as it is (local only) |
| `--remote` | Build in CodeBuild in your account instead of on this machine |
| `--detach` | With `--remote`: start the build and return without waiting |
| `--install-command <cmd>` | Replace the install step |
| `--build-command <cmd>` | Replace the build step |
| `--keep <n>` | Deployments to retain per project (live ones are always kept). Default 10 |

### `list` (alias `ls`)
No options: a table of all projects. `-p, --project <name>` lists one project's deployments. `--json` for scripts.

### `status`
The account, region, stack state, bucket, CloudFront URL, build setup, webhook URL, number of GitHub-connected
projects, the last build, and totals. `--json` for scripts.

### `builds`
| Option | Meaning |
|---|---|
| `-p, --project <name>` | Only builds of this project |
| `--limit <n>` | How many to show (default 10) |
| `--json` | Machine-readable output |

### `logs <build>`
Prints a remote build's log. `<build>` is the short id shown by `builds` (or a full id). `-f, --follow` keeps
streaming until the build finishes. The exit code is 1 if the build did not succeed.

### `rollback`
| Option | Meaning |
|---|---|
| `-p, --project <name>` | Project (required) |
| `--to <deploymentId>` | Deployment to serve (default: the one before the live one) |
| `--host <hostname>` | Host to roll back (default: all of the hosts the project is live on, together) |

### `prune`
| Option | Meaning |
|---|---|
| `-p, --project <name>` | Project (required) |
| `--keep <n>` | Newest deployments to retain (live ones always kept). Default 10 |
| `--grace-minutes <n>` | Leave unrecorded uploads newer than this alone. Default 60 |
| `--dry-run` | Show what would be deleted |

### `delete` (alias `rm`)
`-p, --project <name>` (required), `-y, --yes` to skip the confirmation, `--dry-run` to preview.

### `destroy`
Removes GitHub webhooks, empties both buckets and deletes the stack. `-y, --yes` skips the confirmation.

### `dashboard`
| Option | Meaning |
|---|---|
| `--port <number>` | Port to listen on (default 4173; `127.0.0.1` only) |
| `--no-open` | Print the address without opening the browser |

### `domain add`, `ls`, `verify`, `rm`
| Command | Options | What it does |
|---|---|---|
| `domain add <host>` | `-p, --project`, `--preview` (wildcard preview domain, no project), `--manual`, `--no-wait` | Creates the certificate and distribution, and the DNS records when a Route 53 zone exists. Rerun to continue. `--no-wait` returns instead of waiting for the certificate and DNS |
| `domain ls` | | Hosts with project, stack status, certificate status and whether DNS reaches the distribution |
| `domain verify <host>` | | Checks the stack, certificate, project claim and DNS |
| `domain rm <host>` | `-y, --yes` | Removes the route, distribution stack and certificate, and only the DNS records this tool created |

### `env set`, `import`, `ls`, `rm`
| Command | Options | What it does |
|---|---|---|
| `env set <name> [value]` | `-p, --project`, `--preview` | Sets a variable. Also accepts `NAME=value`, or reads the value from stdin or a hidden prompt when none is given |
| `env import <file>` | `-p, --project`, `--preview` | Sets every variable in a `.env` file (all-or-nothing) |
| `env ls` | `-p, --project`, `--json` | Lists names and which scopes have a value; values are never shown |
| `env rm <name>` | `-p, --project`, `--preview` | Removes a variable |

### `previews`, `previews rm`
`deployer previews [-p <project>] [--json]` lists the preview domain and the open previews.
`deployer previews rm <pr> -p <project>` takes one down. Previews are made by `github connect --previews` plus a
`domain add "*.…" --preview` (section 5.3).

### `github connect`, `deploy`, `disconnect`, `rotate-secret`
| Command | Options | What it does |
|---|---|---|
| `github connect` | `-p, --project`, `--repo <owner/name>`, `--branch`, `--host`, `--install-command`, `--build-command`, `--reuse-token`, `--previews` | Validates the token, stores it, registers the webhook (push events, plus pull request events with `--previews`), saves the connection. `--branch` defaults to the repository's default branch. `--reuse-token` uses the token already stored instead of asking. |
| `github deploy` | `-p, --project`, `--detach` | Builds the current head of the connected branch now |
| `github disconnect` | `-p, --project` | Stops deploying from GitHub. The webhook is removed with the last project on a repository |
| `github rotate-secret` | none | Replaces the webhook's signing secret and creates or updates the webhook on every connected repository |

---

## 7. What your project needs

- A `react` dependency and a `build` script in `package.json`.
- A **Vite** or **Create React App** project. The build output must be `dist/` or `build/` and contain `index.html`.
- **Next.js is rejected** with a clear message, before anything is queued or built.
- Routes that work from the site root, such as React Router's `BrowserRouter`. A Vite `base` or a CRA `homepage`
  pointing at a sub-path will break asset loading.
- **Environment variables are baked in at build time.** For a local deploy they come from your local `.env`. Remote
  and GitHub builds never receive `.env` files; give them their variables with `deployer env` (section 5.4).
  Never put secrets in variables your framework exposes to the browser: they end up in public JavaScript.
- Calls to your own backend need CORS to allow your site's URL.
- Project names use lowercase letters, digits and dashes, start with a letter or digit, and are at most 63 characters.

**Package manager detection** (local and remote): `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`;
`yarn.lock` → `yarn install --frozen-lockfile`; `package-lock.json` → `npm ci`; otherwise `npm install`. Then
`<package manager> run build`.

**What a remote deploy uploads.** The source is zipped using `git ls-files` (so nested `.gitignore` files are honoured),
or, outside a git repository, a directory walk using the root `.gitignore`. These are **never** uploaded:
`node_modules`, `dist`, `build`, `.git`, `.DS_Store` and `.env*`. The limit is 200 MB.

**Cache headers set on upload**

| Files | `Cache-Control` |
|---|---|
| `*.html` | `no-cache` (always revalidated) |
| anything under `assets/` or `static/` | `public, max-age=31536000, immutable` |
| everything else | `public, max-age=3600` |

---

## 8. What gets created in your AWS account

`init` creates one CloudFormation stack (default name `Deployer`).

| Resource | Purpose |
|---|---|
| S3 bucket "sites" (private) | Deployments, and the per-project history files |
| S3 bucket "builds" (private) | Uploaded sources (expire after 7 days), engine code, build script |
| CloudFront distribution, Origin Access Control | Serves the sites over HTTPS; the only reader of the sites bucket |
| CloudFront KeyValueStore | The routing table |
| CloudFront Function | The router |
| CodeBuild project | Runs remote and GitHub builds (Linux, Node 22, 15-minute limit) |
| Lambda "engine" | Promotes a finished build |
| Lambda "webhook" + Function URL | Receives GitHub push events |
| Secrets Manager: webhook secret, GitHub token | Signing secret and the token used to clone |
| Parameter Store (SecureString), created on demand | Your projects' build-time environment variables, under `/deployer/<stack>/…` |
| Per custom domain, created by `domain add`: a CloudFormation stack `<stack>-domain-<host>` with one CloudFront distribution, an ACM certificate (`us-east-1`), and Route 53 records if you have a zone | One hostname with HTTPS |
| 3 CloudWatch log groups | Kept for 14 days |
| 3 IAM roles (+ policies) | See below |

**The three IAM roles are scoped to this stack's own resources:**

| Role | Can |
|---|---|
| Build | Read and write the sites bucket; read `src/*` and `scripts/*` in the builds bucket; invoke the engine; read the GitHub token secret; read this stack's parameters under `/deployer/<stack>/*`; write its own logs |
| Engine | Read and write the sites bucket; read, write and delete entries in this KeyValueStore |
| Webhook | Read `.deployer/*` in the sites bucket; read the webhook secret; start builds on this CodeBuild project |

**Cost.** A small personal setup costs little. CloudFront, Lambda and CodeBuild all have free tiers (CodeBuild's is
100 build-minutes a month on the small instance size), S3 storage for a few sites is pennies, and the main fixed cost
is roughly 40 cents a month for each of the two secrets. Check current AWS pricing for your usage. The CLI's retention
settings keep S3 storage bounded.

---

## 9. Security model

- **No long-lived credentials are stored by the tool.** The CLI uses your AWS profile. Everything running inside AWS
  uses role-based access.
- **The webhook URL is public by design.** The protection is GitHub's HMAC-SHA256 signature, checked with a
  constant-time comparison against a secret generated in your account. A request without a valid signature gets a 401
  and starts nothing. Only `push` events are acted on; `ping` is answered.
- **The webhook secret is never printed by the CLI.** If webhook registration is not possible, the CLI prints the
  command that reads it. If it is ever exposed, `github rotate-secret` replaces it.
- **The GitHub token** is kept in Secrets Manager, passed to git in an HTTP header (never in a URL, so it cannot
  appear in error output). Build logs were scanned for the token (the stack's placeholder value, in tests) and it
  never appeared, but treat logs as sensitive anyway. Use a fine-grained token limited to
  one repository, with a short expiry for testing, and revoke it when you no longer need it.
- **Buckets are private.** Visitors only reach site files through CloudFront. To serve custom domains, the sites
  bucket policy allows any CloudFront distribution **in the same AWS account** to read it through the Origin Access
  Control. Nothing outside the account can.
- **Build code is arbitrary code.** CodeBuild runs a project's own install and build scripts in your account, with the
  build role's permissions. Only build code you trust.
- **Dev credentials.** During development an admin IAM user was used. Before any wider release, replace that with a
  least-privilege policy for whoever runs the CLI. Any access key that has been pasted into a chat, ticket or log
  should be deactivated and replaced.

---

## 10. Limits and known issues

- **The CloudFront URL is one shared address**: the last project deployed to it wins. Give each project a custom
  domain (section 5.5) to avoid that.
- **Preview comments need a token with pull request access.** Without it the preview still works; only the comment is missing (see the engine's log).
- **Custom domains are one distribution each**, so they count against your account's CloudFront quota. The only
  wildcard domain is the one for previews (`--preview`).
- **One preview domain is used per stack** (the first one registered); a preview name is `<project>-pr-<number>`, so
  the project name plus that must fit in 63 characters.
- **Static React only.** No Next.js or server rendering.
- **Remote builds are slow to start** (about 1.5 minutes before your build begins).
- **Missing files return a 403** XML page from S3 instead of a 404.
- **A GitHub token is always required** to connect a repository, even a public one: it registers the webhook and is
  sent when cloning. One token serves a whole stack.
- **Rollback reaches back 10 deployments by default** (`--keep` changes that).
- **Routing changes take about 30 seconds** to reach every edge location, not zero.
- **No automated test suite.** The system was verified by running every feature against a real AWS account, including
  failure cases and a full create and destroy of a throwaway stack. Adding automated tests is future work.
- Not yet exercised: replacing a hostname that another distribution already holds (the error message is written but
  was never triggered for real), updating an existing domain stack (there is no change-set preview for domain stacks, unlike `init`), and registering the webhook on a repository owned by
  a GitHub organization (which may need an owner to approve the token).

---

## 11. Troubleshooting

| You see | Cause and fix |
|---|---|
| `npm ci` fails with `ERESOLVE` (a peer-dependency conflict) | Fix the versions in the project, or deploy with a looser install: `--install-command "npm ci --legacy-peer-deps"`. The CLI repeats this hint when it sees the error. |
| The CLI hangs on AWS calls, especially routing-table writes | Your network advertises IPv6 but drops it. The CLI already prefers IPv4. If you run your own scripts against the AWS SDK, start Node with `NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"`. |
| `GitHub said 403: Resource not accessible by personal access token` | The token lacks the **Webhooks: Read and write** permission. Edit the token's permissions on GitHub (the token itself does not change), then run `deployer github rotate-secret`, which registers the webhook. |
| `GitHub rejected the token` | Expired, revoked or mistyped. Run `github connect` again with a valid token. |
| `Repository … was not found, or the token cannot see it` | The token was not given access to that repository. |
| `Could not fetch <repo> at <sha>` in a build log | The repository does not exist or the stored token cannot read it. Store a new token with `github connect`. |
| `Build output not found: expected dist/index.html or build/index.html` | The build ran but produced no site. Check the project's build script and output folder. |
| `Next.js is not supported yet` | Only static React projects work for now. |
| `deployer: command not found` | The link is gone or your PATH does not include npm's global bin folder (`npm prefix -g`). Run `npm link` again in `apps/cli`. |
| `Stack "Deployer" not found. Run deployer init first.` | The stack does not exist in this account and region, or you are using a different `--profile`, `--region` or `--stack-name`. |
| `domain add` says the hostname is already used by another CloudFront distribution | A hostname can be attached to one distribution only. Remove it from the other distribution (or its stack) first, then rerun. |
| `domain add` waits for the certificate for a long time | Its validation CNAME is not visible. With Route 53 check the zone is delegated (`dig NS <zone> @8.8.8.8`); with manual DNS check you added the record exactly as printed. |
| `domain verify` says DNS does not reach the distribution | The hostname's CNAME or alias is missing or still propagating. Compare with the record `domain add` printed. |
| Visitors get a plain-text "No deployment is live for …" | The hostname has no route. Deploy to it, or roll back to a recorded deployment. |
| A site still shows the old version | Routing changes take about 30 seconds to reach every location. |
| `init` fails, or the stack shows `ROLLBACK_COMPLETE` | Rerun `init`: it removes the failed stack and tries again, and prints the resource that actually failed. |
| `Unknown option` after pasting `--stack-name` from a shell variable in zsh | zsh does not split unquoted variables into words. Write the option out in full. |

---

## 12. The repository, and working on it

```
apps/cli/            the `deployer` command-line tool
  src/commands/      one file per command (deploy, remote-deploy, list, github, …)
  src/lib/           helpers: AWS access, building, zipping, GitHub API, log streaming, formatting
packages/core/       code shared by the CLI and the Lambdas: routing table, history, pruning, object helpers
packages/engine/     the two Lambda functions (promote, webhook) and the script that bundles them into a zip
packages/stack/      the infrastructure definition (AWS CDK), the router function, and the CodeBuild script
docs/                this guide
examples/sample/     a small React app used for testing
```

The code is TypeScript in npm workspaces. `npm run build` runs, in order: `core` → `engine` (bundles the Lambdas into
`apps/cli/assets/engine.zip`) → `stack` (writes `apps/cli/assets/template.json` and copies the build script) → `cli`
(type-checks, then bundles everything into the single file `apps/cli/dist/deployer.mjs`).
The CLI ships the template, engine zip and build script as assets, and `init` uploads them. That is why the stack
needs no `cdk bootstrap`. The published package has no runtime dependencies: AWS request signing for the routing
table uses a pure-JavaScript implementation, so nothing native is installed or shipped to Lambda.

**Conventions worth knowing**

- Anything the CLI and a Lambda both do (set a route, update history, prune) lives in `packages/core`, so a local
  deploy and a cloud deploy cannot drift apart.
- Both the history file and the routing table use optimistic locking. Use `updateManifest` and `setRoute`; do not
  write them directly.
- Names CDK would derive from the construct path are made stack-specific (except for a stack called `Deployer`, which
  keeps its original names so existing installs are not replaced). Check any new fixed physical name the same way.
- Before changing the stack, preview the effect on a live stack with a CloudFormation change set and look for any
  replacement.
- Test new features against a real stack, and test a from-scratch `init` on a throwaway stack name, because upgrading
  an existing stack hides problems that a fresh install hits.

---

## 13. Status and roadmap

**Done and verified against a real AWS account**

| Area | State |
|---|---|
| Infrastructure from scratch, upgrade, and removal (`init`, `destroy`) | done |
| Local deploys, rollback, pruning, project deletion | done |
| Remote builds in CodeBuild, `builds`, `logs` | done |
| GitHub push deploys, secret rotation | done, including a real push from a real repository |
| Concurrency safety (history file and routing table) | done |
| Build-time environment variables (production and preview scopes) | done |
| Local dashboard (`deployer dashboard`): deploy from a folder or GitHub, rollback, domains, variables, live logs | done, driven through its API against a real account |
| Custom domains: Route 53 automatic and manual DNS, side-by-side projects, removal | done, on a real delegated subdomain |
| Pull request previews: wildcard domain, webhook, engine, comment, `previews` commands, dashboard tab | done, including a real pull request: open, push again, close |

**Next (planned):**

1. **A least-privilege policy** for the person running the CLI, before any public release.
2. **A hosted or self-hosted dashboard** that connects to your AWS account (a cross-account role, with no raw keys).
   The local dashboard (section 5.10) already exists and would be the base for it.
3. **Other static frameworks** (Vue, Svelte, Astro static), then **server-rendered frameworks** such as Next.js.

License: Apache-2.0.
