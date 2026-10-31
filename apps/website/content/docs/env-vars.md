---
title: Environment variables
description: Give remote and GitHub builds their build-time variables, stored encrypted in your account.
section: Guides
order: 4
---

A local deploy reads your local `.env` file, as your build tool always does. **Remote and GitHub builds run in AWS and never receive `.env` files**, so their build-time variables are stored with `shipzy env`, encrypted in your account (AWS Systems Manager Parameter Store, SecureString).

```sh
shipzy env set -p my-app VITE_API_URL https://api.example.com
shipzy env set -p my-app API_KEY             # no value given: type it (hidden) or pipe it in
shipzy env import -p my-app .env             # set every variable in a .env file
shipzy env ls -p my-app                      # names and scopes; values are never shown
shipzy env rm -p my-app VITE_API_URL
```

## Good to know

- **A change applies to the next build**, not to what is live. Redeploy with `shipzy deploy --remote` or `shipzy github deploy -p my-app`.
- **Values are never shown.** Not by `env ls`, not by the dashboard, not in logs.
- **Preview values.** `--preview` stores a value used only by preview builds. A preview build gets the production values with any preview values laid over them, so a preview only needs to list what differs.
- **Limits.** Names starting with `DEPLOY_`, `SOURCE_`, `AWS_` or `CODEBUILD_`, and a few build-system names, are reserved. Values cannot be empty and are limited to 4096 bytes. `import` checks the whole file first and writes nothing if any line is invalid.

## Do not put secrets in browser-exposed variables

Build-time variables end up in your built JavaScript if your framework exposes them to the browser:

| Framework | Exposed to the browser |
|---|---|
| Vite | `VITE_*` |
| Create React App | `REACT_APP_*` |
| Next.js | `NEXT_PUBLIC_*` |

Use those for public configuration such as an API address, not for secrets. Other variables are visible to the build process only.
