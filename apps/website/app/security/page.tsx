import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Security', description: 'Where shipzy runs, what it is allowed to do in your AWS account, how secrets are handled, and the limits we want you to know about.' };

export default function Security() {
  return (
    <>
      <div className="container narrow page-head">
        <h1>Security</h1>
        <p>The safest system is one where we never hold anything worth stealing. This page explains how shipzy is built around that, what it is allowed to do in your account, and where its limits are.</p>
      </div>

      <div className="container narrow page-body">
        <div className="prose">
          <div className="callout"><strong>The short version.</strong> shipzy runs on your machine and in your AWS account. We operate no servers, no accounts and no database, so there is no shipzy backend that could be breached to reach your sites, your code or your keys.</div>

          <h2 id="where">What runs where</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Place</th><th>What runs there</th></tr></thead>
              <tbody>
                <tr><td>Your machine</td><td>The CLI, the optional local dashboard, and local builds. It uses your own AWS profile.</td></tr>
                <tr><td>Your AWS account</td><td>The sites, the CDN, builds, the two functions, and your secrets. Everything uses roles scoped to that stack.</td></tr>
                <tr><td>GitHub</td><td>Your repository, and a webhook that calls your own function URL.</td></tr>
                <tr><td>Servers we operate</td><td>None. The CLI is delivered through the npm registry and nothing phones home.</td></tr>
              </tbody>
            </table>
          </div>

          <h2 id="permissions">Permissions: what shipzy is allowed to do</h2>
          <p>An administrator key works, but it is far more than the tool needs. We publish a policy that allows only what shipzy does, and a script that creates a user with it:</p>
          <ul>
            <li>CloudFormation stacks, S3 buckets, Lambda functions and IAM roles <strong>whose names start with the stack name</strong>;</li>
            <li>CloudFront, CodeBuild, certificates, Route 53 records, and the stack’s own parameters and two secrets;</li>
            <li>nothing else: not your other buckets, not other IAM users or access keys, not other services.</li>
          </ul>
          <p><a href="/iam/deployer-cli-policy.json">Download the policy</a> and <a href="/iam/create-limited-user.sh">the script</a>, and read them before you run anything. We checked the policy with the AWS policy simulator, and by running setup, deploys (local, remote and GitHub), domains, rollback, delete and destroy with a user that has only this policy.</p>
          <p>Inside the stack, three roles do the work, and each can only reach this stack’s own resources:</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Role</th><th>Can</th></tr></thead>
              <tbody>
                <tr><td>Build</td><td>Read and write the sites bucket, read its source, invoke the publish function, read the GitHub token and this stack’s parameters, and write its own logs</td></tr>
                <tr><td>Engine</td><td>Read and write the sites bucket and the routing table</td></tr>
                <tr><td>Webhook</td><td>Read project history, read the webhook secret, and start builds on this project</td></tr>
              </tbody>
            </table>
          </div>

          <h2 id="secrets">Secrets and tokens</h2>
          <ul>
            <li><strong>No long-lived keys are stored by shipzy.</strong> The CLI uses your AWS profile, and everything in AWS uses roles.</li>
            <li><strong>Your GitHub token</strong> lives in Secrets Manager and is passed to git in a request header, never in a URL, so it cannot show up in error output.</li>
            <li><strong>Environment variables</strong> are stored as encrypted parameters. Their values are never printed, returned by the dashboard, or written to a log, and they travel to a process by environment or standard input, never on a command line.</li>
            <li><strong>The webhook secret</strong> is generated in your account and never printed. If it is ever exposed, one command replaces it.</li>
          </ul>

          <h2 id="webhook">The webhook</h2>
          <p>The webhook URL is public by design, so the protection is GitHub’s HMAC-SHA256 signature, checked in constant time against a secret from your account. A request without a valid signature gets a 401 and starts nothing.</p>
          <p>For pull request previews, only branches of the <strong>same repository</strong> are built, because a build receives your project’s variables and a fork’s code must never see them. Before a preview goes live, the publish function asks GitHub whether the pull request is still open and still at that commit, so a late or superseded build never goes live.</p>

          <h2 id="storage">Your files</h2>
          <p>Both buckets are private, and visitors only reach your files through CloudFront. The sites bucket allows distributions <strong>in the same AWS account</strong> to read it, and nothing outside the account can.</p>

          <h2 id="dashboard">The local dashboard</h2>
          <ul>
            <li>It listens on <code>127.0.0.1</code> only, so it is not reachable from your network.</li>
            <li>Every launch has a random token. Opening the printed address signs your browser in with a cookie, and requests need that cookie, a matching <code>Host</code> header (against DNS rebinding) and, for changes, a matching <code>Origin</code> (against cross-site requests).</li>
            <li>Every value from the browser is validated before it becomes an argument, and commands are run as argument lists, never through a shell.</li>
            <li>A GitHub login made through the dashboard is held in the memory of the running process and is never written to disk or sent to the browser.</li>
          </ul>

          <h2 id="limits">Honest limits</h2>
          <div className="callout warn"><strong>Early preview.</strong> shipzy has not had an independent security audit. Read the code (it is open source), and start with a throwaway AWS account if you are cautious.</div>
          <ul>
            <li><strong>Builds run your code.</strong> CodeBuild executes your project’s install and build scripts in your account, with the build role’s permissions. Only build code you trust.</li>
            <li><strong>The CLI policy can create roles named for the stack.</strong> Someone holding that key could attach extra rights to such a role. Treat the key as sensitive, do not share it, and prefer a short-lived profile where you can.</li>
            <li><strong>AWS has no hard spending cap.</strong> A traffic spike or an attack can raise your bill. Create an AWS Budget alert for the account. A guided alarm in <code>shipzy init</code> is planned.</li>
            <li><strong>The local dashboard trusts your machine.</strong> Anyone who can use your browser session while it runs has your AWS access through it. Stop it when you are done.</li>
            <li><strong>The dashboard’s GitHub login asks for the <code>repo</code> scope.</strong> That is broader than a token limited to one repository. If you prefer the narrower one, paste a token instead.</li>
          </ul>

          <h2 id="verify">Verify it yourself</h2>
          <p>shipzy is open source under the Apache-2.0 license. The CLI package is a single bundled file with no runtime dependencies, which keeps what you install small enough to read. Everything it creates is a plain CloudFormation stack you can inspect, change or delete, and <code>shipzy destroy</code> removes all of it.</p>
          <p>More detail on each part is in <Link href="/docs/limits">limits and roadmap</Link> and <Link href="/docs/aws-setup">AWS setup</Link>.</p>
        </div>
      </div>
    </>
  );
}
