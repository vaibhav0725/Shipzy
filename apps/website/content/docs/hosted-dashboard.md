---
title: Dashboard in your AWS account
description: Run the dashboard from anywhere, for your team, in your own AWS account behind a GitHub sign-in. Nothing runs on shipzy servers.
section: Dashboard
order: 2
---

The [local dashboard](/docs/dashboard) runs on your computer and stops when you close the terminal. The hosted dashboard is the same dashboard running **in your own AWS account**, at an address you can open from any browser, including your phone, and share with your team. Only the GitHub usernames you list can sign in.

It is still your account and your bill, and **nothing runs on shipzy servers**: there is no shipzy account, and we never hold access to your AWS.

## Set it up

You need the stack from `shipzy init`, a stored GitHub token if you want to deploy repositories (`shipzy github connect` once), and permission to create stacks (the [published policy](/docs/aws-setup) covers it; re-run its script if your user predates the hosted dashboard).

```sh
shipzy dashboard --deploy --allow your-github-username
```

This packages the dashboard, uploads it to your builds bucket, and creates a stack named `<stack>-dashboard` (so `Deployer-dashboard` by default). It prints the address. Then connect the sign-in:

1. At [github.com/settings/developers](https://github.com/settings/developers) choose **OAuth Apps**, then **New OAuth App**.
2. Set the Homepage URL to the dashboard address and the Authorization callback URL to that address followed by `/auth/callback` (the command prints both).
3. Generate a client secret, then run `shipzy dashboard --configure` and enter the client ID and the secret. They are stored in AWS Secrets Manager in your account, and take effect within seconds.

Open the address and sign in with GitHub.

### Change who can sign in

Run the deploy again with the full list: `shipzy dashboard --deploy --allow alice,bob`. A person removed from the list is refused on their next request.

### Remove it

`shipzy dashboard --remove` deletes the stack and its job history. Your sites and projects are untouched.

## What it can and cannot do

It does what the CLI does for projects that already exist, from a GitHub repository: deploy a repository, build the connected branch now, roll back, clean up, delete a project, manage domains, environment variables and previews, and follow build logs.

It cannot:

- **Deploy a folder from your computer.** There is no folder; use the CLI for that, or push to GitHub.
- **Paste a GitHub token or import a `.env` file.** Connect the token once with `shipzy github connect`; the hosted dashboard uses the one stored in your account. Set variables one at a time.
- **Run `init`, change the main stack, or touch IAM.** Those stay with the CLI and an administrator.

Cancelling a job stops the job in the dashboard. A build that had already started in your AWS account carries on and still deploys when it finishes.

## How it works

Two Lambda functions share one code package (the dashboard, the CLI and two small handlers):

- **web** answers browser requests at a Function URL. It checks the GitHub sign-in, reads your shipzy state, and starts jobs. It cannot change anything.
- **worker** runs a job (a CLI command) in the background and writes the log to a private S3 bucket, kept for 14 days. The web function shows it by polling every second or two.

The cost is a few cents a month at normal use: Lambda is billed per request and per second of running time, and the S3 and CloudWatch usage is tiny. `shipzy cost` does not list it separately yet.

## Security

A web page that can deploy and delete things deserves care, so here is exactly what it does and what it does not:

- **Sign-in.** GitHub's OAuth flow proves who someone is, then only the listed usernames get a session. The GitHub access token is discarded straight away and no GitHub permissions are requested. The session is a signed, `Secure`, `HttpOnly` cookie that lasts 12 hours, and the allow-list is checked again on every request. Writes also require the request to come from the dashboard's own address.
- **Narrow permissions.** The functions' roles can create no IAM roles, users or keys, cannot change the main stack, and can reach only shipzy's own buckets, routing table, build project, secrets, and the per-project and per-domain stacks. This is narrower than the CLI user's policy. They are also explicitly refused when asked to decrypt Parameter Store values, so your environment variable values stay unreadable to them.
- **Where secrets travel.** Environment variable values you set in the dashboard pass through the job request to the worker (encrypted by AWS in transit and at rest) and are hidden from the log.
- **Signing out** ends the dashboard session. You stay signed in to GitHub itself, so signing in again does not ask for a password.

What it does not have yet, and what to do about it:

- **No rate limiting or firewall.** The address is public, so anyone can send it requests (they are refused unless signed in, but each request runs a function and costs a fraction of a cent). If that worries you, put the address behind your own CloudFront and a web application firewall.
- **No independent security review.** Use GitHub two-factor authentication for everyone on the list: a stolen session of an allowed person can manage your projects, though not your AWS account.
- **A beta.** Treat it as such, and look at the stack it creates in your account before you rely on it.
