---
title: Limits and roadmap
description: What shipzy does not do yet, the limits to know about, and what is planned.
section: Reference
order: 3
---

shipzy is an **early preview**. Everything below is as accurate as we can make it, including the parts that are less flattering.

## What it does not do yet

- **Static sites only.** Vite, Create React App and static Next.js exports. Server-rendered Next.js (API routes, middleware, per-request rendering), servers and long-running processes are not supported.
- **No hosted dashboard.** The dashboard runs on your own computer. A hosted one that connects to your AWS account is planned.
- **One cloud.** shipzy targets AWS only.

## Limits

- **A new project's first deploy takes about five minutes longer** while CloudFront creates its address. Later deploys do not.
- **Project addresses are random CloudFront names** (`dxxxx.cloudfront.net`). Add a [custom domain](/docs/domains) for a readable one.
- **Routing changes take about 30 seconds** to reach every edge location, not zero.
- **Remote builds are slow to start** (about 1.5 minutes before your build begins). A local deploy is the fast choice.
- **Rollback reaches back 10 deploys by default** (`--keep` changes that).
- **Custom domains are one CloudFront distribution each**, so they count against your account's CloudFront quota.
- **One preview domain is used per stack**, and a preview name is `<project>-pr-<number>`, so the project name plus that must fit in 63 characters.
- **A GitHub token is required to connect a repository**, even a public one: it registers the webhook and is sent when cloning. One token serves a whole stack.
- **Preview comments need a token with pull request access.** Without it the preview still works; only the comment is missing.
- **AWS has no hard spending cap.** `shipzy init --budget 25 --budget-email you@example.com` sets an alert that emails you, and `shipzy cost` shows the month so far. Neither stops spending.

## Known gaps

- shipzy's main features have been verified by running them against a real AWS account, including failure cases and a full create and destroy of a throwaway stack. It does **not** yet have an automated test suite, and it has **not** had an independent security audit.
- Not yet exercised for real: replacing a hostname that another distribution already holds, updating an existing domain stack in place, and registering the webhook on a repository owned by a GitHub organization (which may need an owner to approve the token).

## Roadmap

Roughly in this order:

1. **A first public release.**
2. **Server-rendered Next.js**, running in your account on Lambda, with the cost and trade-offs written down first.
3. **Generic servers**: a Node or Express app as a function, then containers for anything else (Python, Go, WebSockets).
4. **A hosted dashboard** that connects to your AWS account through a cross-account role, with a GitHub App for one-click repository access.
5. **Other static frameworks** (Vue, Svelte, Astro static).

Dates are not promised. If something here matters to you, tell us.
