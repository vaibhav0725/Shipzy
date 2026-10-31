---
title: Domains
description: Serve a project on your own domain with HTTPS, with DNS created for you in Route 53 or printed for any provider.
section: Guides
order: 3
---

Every project already has its own CloudFront address. A custom domain puts it on a name you own, with HTTPS.

```sh
shipzy domain add app.example.com -p my-app    # certificate + distribution + DNS (5 to 15 minutes)
shipzy domain ls                               # hosts, project, stack, certificate and DNS state
shipzy domain verify app.example.com           # re-check everything; safe to run any time
shipzy domain rm app.example.com               # remove it completely (asks to confirm)
```

## What `domain add` does

It can be rerun at any point to continue where it stopped.

1. **Finds DNS.** It looks for a **Route 53 hosted zone** in your account that covers the hostname.
   - **Zone found:** every DNS record is created for you, and `domain rm` removes the ones it created.
   - **No zone, or `--manual`:** the exact records are printed and the command waits. Add them wherever your DNS is hosted. There are two: a validation CNAME for the certificate (keep it, since the certificate renews through it) and a CNAME from your hostname to the CloudFront address it prints.
2. **Requests a free ACM certificate** in `us-east-1` (CloudFront requires that region).
3. **Creates a small CloudFormation stack** with one CloudFront distribution that reuses your main router, routing table and bucket access. Your main distribution is never touched.
4. **Routes the hostname** to the project's live deploy.

Deploys then update all of the project's domains together, and rollback moves them together.

## Using a domain from GoDaddy, Namecheap and others

Pick a **subdomain** and delegate it to Route 53, so everything is automatic:

1. In Route 53, create a hosted zone for the subdomain, for example `apps.example.com`. It shows four name servers.
2. At your registrar, add four `NS` records named `apps` (the subdomain part only) with those four values.
3. Check it: `dig NS apps.example.com @8.8.8.8`. Then `shipzy domain add blog.apps.example.com -p blog` just works.

Your main site on `example.com` is unaffected.

If you would rather not delegate, use `--manual` and add the two printed records yourself.

> **A bare domain (`example.com`) cannot be a CNAME**, which is what most registrars offer. Use a subdomain such as `www.example.com`, or move the domain's DNS to Route 53.

## Good to know

- A hostname can belong to **one CloudFront distribution in the world**. If it already belongs to another (an old site, for example), `domain add` stops and says so. Remove it from that distribution first.
- Each domain is one distribution and one certificate. Certificates are free, and an idle distribution costs nothing.
- Route 53 charges about $0.50 a month per hosted zone.
- **Enter the Name without your main domain.** Providers such as GoDaddy and Namecheap add your domain themselves. For `shipzy.example.com`, a record named `_abc123.shipzy.example.com` must be entered as `_abc123.shipzy`, and the alias as `shipzy`. If it is entered in full, the domain is added twice and the certificate never validates. `domain add` checks public DNS after a minute and tells you if it finds the record under the doubled name.
- `--no-wait` returns instead of waiting for the certificate and DNS. Rerun the same command later to continue.

## Wildcard preview domain

One wildcard domain serves the previews of every project. See [Previews](/docs/previews).
