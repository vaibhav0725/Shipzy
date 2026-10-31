---
title: Troubleshooting
description: Error messages you may see, what causes them, and how to fix them.
section: Reference
order: 2
---

| You see | Cause and fix |
|---|---|
| `Stack "Deployer" not found. Run shipzy init first.` | The stack does not exist in this account and region, or you are using a different `--profile`, `--region` or `--stack-name`. |
| `shipzy: command not found` | Your PATH does not include npm's global bin folder (`npm prefix -g`), or the install did not finish. Run `npm install -g shipzy` again. |
| `npm ci` fails with `ERESOLVE` (a peer-dependency conflict) | Fix the versions in the project, or deploy with a looser install: `--install-command "npm ci --legacy-peer-deps"`. shipzy repeats this hint when it sees the error. |
| `This is a Next.js project that is not set up for a static export` | Add `output: 'export'` (and `images: { unoptimized: true }`) to `next.config`. A project that needs a server cannot be deployed. See [Next.js](/docs/nextjs). |
| `Image Optimization using the default loader is not compatible with export` | Add `images: { unoptimized: true }` to `next.config`. |
| `Build output not found` | The build ran but produced no site. Check the project's build script and its output folder (`dist/`, `build/` or `out/`). |
| `GitHub said 403: Resource not accessible by personal access token` | The token lacks the **Webhooks: Read and write** permission. Edit the token's permissions on GitHub (the token itself does not change), then run `shipzy github rotate-secret`, which registers the webhook. |
| `GitHub rejected the token` | Expired, revoked or mistyped. Run `github connect` again with a valid token. |
| `Repository … was not found, or the token cannot see it` | The token was not given access to that repository. |
| `Could not fetch <repo> at <sha>` in a build log | The repository does not exist or the stored token cannot read it. Store a new token with `github connect`. |
| `domain add` says the hostname is already used by another CloudFront distribution | A hostname can belong to one distribution only. Remove it from the other distribution first, then rerun. |
| `domain add` waits for the certificate for a long time | The validation CNAME is not visible. With Route 53, check the zone is delegated (`dig NS <zone> @8.8.8.8`). With manual DNS, check you added the record exactly as printed. |
| `domain add` reports the record exists "but at …" with your domain repeated | Your DNS provider added your main domain to the Name you typed. Edit the record and enter only the part before your main domain (for example `_abc123.shipzy`, not `_abc123.shipzy.example.com`). |
| `domain verify` says DNS does not reach the distribution | The hostname's CNAME or alias is missing or still propagating. Compare with the record `domain add` printed. |
| Visitors get a plain-text "No deployment is live for …" | The hostname has no route. Deploy to it, or roll back to a recorded deploy. |
| A site still shows the old version | Routing changes take about 30 seconds to reach every location. |
| A missing page shows a plain "Access Denied" instead of a 404 | The project's address or domain was created before 404 pages were added. Recreate it (delete and redeploy the project, or `domain rm` then `domain add`). |
| `init` fails, or the stack shows `ROLLBACK_COMPLETE` | Rerun `init`: it removes the failed stack and tries again, and prints the resource that actually failed. |
| The CLI hangs on AWS calls | Your network may advertise IPv6 but drop it. shipzy already prefers IPv4. For your own scripts, start Node with `NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"`. |
| `The local dashboard is an optional download and is not installed` | Run `shipzy dashboard --install`, or answer `y` when it asks. |
| `Unknown option` after pasting `--stack-name` from a shell variable in zsh | zsh does not split unquoted variables into words. Write the option out in full. |

## Still stuck?

Run the command again with a clear head and read the **last lines** of the output: shipzy prints the underlying AWS error when it can. For a build, `shipzy builds -p <project>` and `shipzy logs <build>` show what happened in your account.
