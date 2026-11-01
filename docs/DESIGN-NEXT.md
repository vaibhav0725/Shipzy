# Next up: server-rendered Next.js and a hosted dashboard

Design notes, written before any code. Prices are list prices as understood today and need checking before they are quoted anywhere.

## 1. Server-rendered Next.js (SSR)

### What changes
Today a deploy is a folder of static files and the router only picks a folder. A server-rendered app also needs a function that runs on request (pages, route handlers, middleware, image optimisation, ISR revalidation).

### Recommended approach: build with OpenNext, serve with our router
- **Do not write our own Next.js server adapter.** [OpenNext](https://opennext.js.org/aws) (`@opennextjs/aws`) already turns a Next.js build into: static assets, a server function, an image-optimisation function and a revalidation function. We run it as the build step (locally, or in CodeBuild like today).
- **Static assets** go to the same immutable deploy folder in S3 (`<project>/<deploy-id>/`), exactly as now.
- **The server function** is one Lambda function per deploy (a version, so it is immutable), reached through a Lambda function URL.
- **Routing keeps working as the one switch.** The KeyValueStore gets one more key per deploy, `fn:<project>/<id>` = the function URL's host. The viewer-request router sends paths that are files to S3 and everything else to that function (CloudFront Functions on the JS 2.0 runtime can change the origin per request). **Rollback stays a routing change**, because the old deploy's function and files are still there.
- **Access control:** CloudFront signs requests to the function URL (Origin Access Control for Lambda URLs), so the function cannot be called directly.

### Things to prove first (a spike of about a day, before committing to the design)
1. A CloudFront Function can switch the origin to a Lambda function URL that uses OAC (the documentation for this combination is thin).
2. Streaming responses and the 6 MB / 20 MB response limits behave for a normal app.
3. OpenNext's ISR needs (a DynamoDB table, an SQS queue, an S3 cache prefix) can live in the existing stack, once per project rather than once per deploy.
4. Cold start time on a typical app (the usual range is 300 ms to 1.5 s) and whether provisioned concurrency is worth offering.

### Spike results (run on 2026-11-01 against a real account, then deleted)
A throwaway stack with two Lambda function URLs behind one CloudFront distribution, a viewer-request CloudFront Function (JS 2.0) and an Origin Access Control for Lambda:
- **Works:** the function switches the origin per request with `cf.updateRequestOrigin({domainName, originAccessControlConfig: {...originType: 'lambda'}})`. `/` reached function A and `/b/x` reached function B, both signed by the OAC. Calling the function URL directly returned 403, so the functions are not reachable except through CloudFront.
- **Does not work as is: POST/PUT with a body.** Through the OAC, a POST without an `x-amz-content-sha256` header failed with a signature mismatch (403); with the header it returned 200. Browsers do not send that header, so forms, route handlers and server actions would break. This is a documented limitation of OAC for Lambda URLs.
- **Decision needed for the real design:** use `AuthType NONE` on the function URL and have CloudFront add a secret header (a per-project secret, added by the same origin switch via `customHeaders`) that a thin wrapper in the function checks before running Next.js. The function stays unreachable without the secret, and POST bodies work. Not yet tested; prove it first thing in the build. The alternative, Lambda@Edge hashing the body, is slower and costs more.
- The spike granted the CloudFront principal both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` on each function (AWS documentation says newer function URLs need both). It did not test whether either alone is enough, so keep both.

### Cost shape (estimate)
Lambda is about $0.20 per million requests plus compute time (about $0.0000167 per GB-second), plus CloudFront as today. A small app costs cents a month; a busy one is a few dollars per million page views. `shipzy cost` would gain a Lambda line.

### Permissions and cleanup
- The engine (and the CLI user's policy) must create, publish and delete Lambda functions for the project and nothing else: names `Deployer*`-style prefix plus project, same pattern as today.
- `prune` and `delete` must remove old deploy functions with the deploy folders, or they keep costing nothing but also keep piling up against the account's function quota.

### What stays out
Edge-runtime middleware that needs CloudFront-specific behaviour, `next/image` with remote loaders at large scale, and non-Next frameworks. Say so plainly in the docs.

### Order of work
1. Spike (items above). Write down what failed.
2. Detection: `output: 'export'` absent is no longer an error, it selects SSR mode (and `shipzy deploy` says what it will create and what it costs).
3. Build with OpenNext, upload, create the function version, write `fn:` and `mode:` keys.
4. Router change and promote/rollback tests, including rollback between a static and an SSR deploy.
5. Previews, env vars (they become Lambda environment variables, so secret handling needs a decision), prune, delete, cost.
6. Docs, limits page, a deliberately small first release labelled beta.

## 2. Hosted dashboard

The promise today is "nothing runs on our servers". A dashboard that we host breaks that promise, so there are two very different products.

### Option A (recommended first): your own dashboard, in your own AWS account
`shipzy dashboard --deploy` installs the dashboard as a small stack in the user's account (a Lambda behind CloudFront, sign-in through GitHub or a passkey, the same least-privilege role as the CLI). Reachable from anywhere, shared by a team, and **still nothing runs on shipzy servers**.
- Needs: the dashboard to call AWS in-process (today it spawns the CLI as a child process, which Lambda cannot do well), a login that is not the local launch token, and a way to store job logs (S3).
- Work: replace the spawn layer with the CLI's library functions (`listProjects`, `readManifest`, `deployStack`... are already importable), add auth, add a stack, long jobs run as CodeBuild or Step Functions rather than a Lambda that times out.
- Risk: a login page on the public internet in front of an account that can deploy and delete things. Needs a security review and rate limiting before release.

### Option B (later, only if wanted): a service we run
Users sign in to us, add their AWS account by creating a cross-account IAM role (a CloudFormation quick-create link with an ExternalId), and we assume it. Convenient, but we become a high-value target (a role in many accounts), need billing, support and incident response, and we would have to rewrite "nothing runs on our servers" everywhere. Do not start this until there is demand and a security audit plan.

### Recommendation
Build A. It keeps the promise, serves teams, and everything built for it (in-process calls, auth, job storage) is what B would need anyway.

## Suggested order across everything
1. Finish verifying push-to-deploy and PR previews with Next.js (nothing else should ship on an unverified base).
2. SSR spike, then SSR.
3. Dashboard in your own account.
