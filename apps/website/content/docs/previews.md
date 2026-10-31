---
title: Previews
description: Give every pull request its own URL, rebuilt on every push and removed when the pull request closes.
section: Guides
order: 5
---

Each open pull request can get its own address, such as `my-app-pr-12.preview.example.com`, rebuilt on every push and removed when the pull request closes. A comment with the link is kept up to date on the pull request.

## Set it up

**One time per stack**, add a wildcard preview domain. It serves the previews of every project, and has its own certificate and distribution like any [custom domain](/docs/domains):

```sh
shipzy domain add "*.preview.example.com" --preview
```

**One time per project**, connect it to GitHub with previews on. Give the token **Pull requests: Read and write**, so the comment can be posted:

```sh
shipzy github connect -p my-app --repo owner/name --previews --reuse-token
```

Then open a pull request into the connected branch. Look at what exists with `shipzy previews`, or remove one by hand with `shipzy previews rm -p my-app 12`.

## How it behaves

- Only pull requests from a branch **of the same repository** are built. A fork's code is never run, because a build receives the project's variables.
- A preview build gets the project's production variables with any preview-only values laid over them ([Environment variables](/docs/env-vars)).
- Before a preview goes live, the publish function asks GitHub whether the pull request is still open and still at that commit. A late or superseded build never goes live, and a closed pull request is never revived.
- A failed preview build comments on the pull request, and the previous preview keeps being served.
- Previews never count towards the newest-10 retention of production deploys, and are never touched by `rollback`. Only the newest build of each pull request is kept.
- Removing the preview domain (`shipzy domain rm "*.preview.example.com"`) removes every preview on it.

## Limits

- One preview domain is used per stack. A preview name is `<project>-pr-<number>`, so the project name plus that must fit in 63 characters.
- Without pull request access on the token, the preview still works; only the comment is missing.
