---
title: Next.js
description: Deploy a static export of a Next.js project, and what a static export can and cannot do.
section: Guides
order: 2
---

shipzy deploys Next.js as **a static export**: `next build` writes the whole site, one HTML file per page, and shipzy uploads those files. No server runs, which keeps the cost near zero and the setup small.

## Set up the export

In `next.config.mjs` (or `.js` or `.ts`):

```js
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
};

export default nextConfig;
```

Then deploy as usual:

```sh
shipzy deploy ./my-next-app --project my-next-app
```

shipzy runs `next build` and uploads the `out/` folder. Both the App Router and the Pages Router work, and dynamic routes work when they list their pages up front (`generateStaticParams` in the App Router, `getStaticPaths` in the Pages Router).

## Pre-rendered does not mean no JavaScript

Pages are rendered to HTML at build time. They are still React apps in the browser after they load, so client components, state, effects and client-side navigation all work.

## What a static export cannot do

shipzy checks before it builds, and stops with the exact reason rather than deploying a site that behaves differently:

- **Middleware** (`middleware.ts`, `proxy.ts`) does not run on a static site.
- **API routes** (`pages/api`) need a server.
- **`getServerSideProps`**, per-request rendering and revalidation (ISR) are not available.
- **Image optimization** needs a server, which is why `images: { unoptimized: true }` is required.
- **`redirects`, `rewrites` and `headers`** in `next.config` are ignored by a static export.

Route handlers that only answer `GET` are built to files and work.

If you hit one of these, you will see a message like this:

```text
Error: This is a Next.js project that is not set up for a static export (next.config.mjs has no output: 'export').
Only a static export of Next.js can be deployed (no server runs on this platform). In next.config add:
  output: 'export',
  images: { unoptimized: true },
```

Server-rendered Next.js is on the [roadmap](/docs/limits).

## How paths are served

| Request | What is served |
|---|---|
| `/` | `index.html` |
| `/about` | `about.html` |
| `/blog/hello` | `blog/hello.html` |
| `/about/` | redirects to `/about` |
| a path with no page | a real **404** with your own `404.html` / `not-found` page |

With `trailingSlash: true` in `next.config`, shipzy detects the folder-style output and serves `/about/` from `about/index.html`, redirecting `/about` to `/about/`. Query strings are kept on redirects.

## Environment variables

Variables named `NEXT_PUBLIC_*` are baked into the site **at build time**, exactly like `VITE_*` for Vite. For a local deploy they come from your local `.env` file. For `--remote` and GitHub builds, set them with `shipzy env`:

```sh
shipzy env set -p my-next-app NEXT_PUBLIC_API_URL https://api.example.com
```

Never put secrets in a `NEXT_PUBLIC_` variable: it ends up in public JavaScript. See [Environment variables](/docs/env-vars).

## Caching

Files under `_next/static/` have content hashes and are cached for a year. HTML and Next's page payloads (`.txt`) are always revalidated, so a new deploy is picked up straight away.

## Trying the output locally

```sh
npm run build
npx serve out
```

## Common errors

| You see | Fix |
|---|---|
| `not set up for a static export` | Add `output: 'export'` to `next.config`. |
| `Image Optimization using the default loader is not compatible with export` | Add `images: { unoptimized: true }`. |
| `uses features a static site cannot provide` | Remove the listed middleware or API routes, or deploy a different way. |
| `Build output not found: expected out/index.html` | The build did not export. Check `output: 'export'` and the build log. |
