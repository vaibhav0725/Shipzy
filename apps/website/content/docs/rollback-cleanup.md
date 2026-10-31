---
title: Rollback and cleanup
description: Go back to an earlier deploy in seconds, and remove old deploys, projects or the whole stack.
section: Guides
order: 6
---

## See what you have

```sh
shipzy status           # account, stack, URL, build setup, last build, totals
shipzy list             # every project: where it is live, how old, source, versions, size
shipzy list -p my-app   # one project's deploys, and which is live
```

## Roll back

```sh
shipzy rollback -p my-app                                  # back to the previous deploy
shipzy rollback -p my-app --to d-20261029T104026-4dc09a    # or to a specific one
```

Rollback points the hostnames at an older folder. There is no build and no upload, and it takes effect at the edge in about 30 seconds. All of a project's hosts move together unless you pass `--host`.

Only recorded deploys can be rolled back to, and the newest 10 are kept by default.

## Clean up old deploys

```sh
shipzy prune -p my-app --dry-run    # see what would be deleted
shipzy prune -p my-app              # delete it
```

Pruning is automatic after every deploy. It keeps the newest `--keep` deploys (10 by default) plus anything live, and removes uploads that were never promoted. It never deletes something a host is pointing at.

## Delete a project

```sh
shipzy delete -p my-app --dry-run   # show what would be removed
shipzy delete -p my-app             # asks you to type the project name
```

This removes the project's routes, every deploy, its uploaded sources, its variables, its own address, its custom domains, its previews and its GitHub webhook. **If the project is live, that site starts returning 404.**

## Remove everything

```sh
shipzy destroy                      # asks you to type the stack name
```

`destroy` removes the custom domains and the preview domain first (each one's distribution, certificate and the DNS records shipzy made), then the webhooks, variables and buckets, and finally the stack. If a domain cannot be removed it stops **before** deleting anything else and tells you which one. Fix that (or run `shipzy domain rm <host>`) and run `destroy` again; an interrupted `destroy` picks up where it stopped.

CloudFront takes a few minutes to delete, and the command shows a timer while it waits.
