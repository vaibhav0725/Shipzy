import type { Metadata } from 'next';
import Link from 'next/link';
import Diagram from '@/components/Diagram';

export const metadata: Metadata = { title: 'How it works', description: 'What shipzy creates in your AWS account, what happens when you deploy, and how a visitor’s request is served.' };

export default function HowItWorks() {
  return (
    <>
      <div className="container narrow page-head">
        <h1>How it works</h1>
        <p>shipzy is a command-line tool and a small set of resources in your AWS account. Here is what exists, what happens on a deploy, and how a visitor gets your site.</p>
      </div>

      <div className="container" style={{ marginBottom: 40 }}>
        <div className="card" style={{ padding: 28 }}><Diagram /></div>
      </div>

      <div className="container narrow page-body">
        <div className="prose">
          <h2 id="three-pieces">Three pieces</h2>
          <ul>
            <li><strong>The CLI (and the optional dashboard)</strong> runs on your machine. It reads your AWS profile, builds your project if you ask it to, and writes to your account.</li>
            <li><strong>A stack in your AWS account</strong>, created by <code>shipzy init</code>: storage for your sites, a CDN, a build project, and two small functions. You can see all of it in the AWS console.</li>
            <li><strong>A routing table at the edge</strong> that says which deploy each hostname should serve. Going live and rolling back are single writes to this table.</li>
          </ul>
          <p>There is no fourth piece. We do not run a server, a database or a control plane.</p>

          <h2 id="what-init-creates">What <code>shipzy init</code> creates</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Resource</th><th>What it is for</th></tr></thead>
              <tbody>
                <tr><td>S3 bucket (private)</td><td>Every deploy of every project, and each project’s history</td></tr>
                <tr><td>CloudFront distribution</td><td>Serves your sites over HTTPS, and is the only reader of the bucket</td></tr>
                <tr><td>CloudFront Function and KeyValueStore</td><td>The router, and the routing table it reads on every request</td></tr>
                <tr><td>CodeBuild project</td><td>Runs builds in your account (remote and GitHub deploys)</td></tr>
                <tr><td>Two Lambda functions</td><td>One receives GitHub webhooks, one publishes a finished build</td></tr>
                <tr><td>Secrets Manager (two secrets)</td><td>The webhook signing secret and your GitHub token</td></tr>
                <tr><td>Parameter Store (on demand)</td><td>Your projects’ build-time environment variables, encrypted</td></tr>
                <tr><td>Three IAM roles</td><td>Build, engine and webhook, each limited to this stack’s own resources</td></tr>
              </tbody>
            </table>
          </div>
          <p>Each project’s first deploy adds one more small stack: a CloudFront distribution that gives the project its own <code>dxxxx.cloudfront.net</code> address. A custom domain adds another, with its certificate and DNS records.</p>

          <h2 id="deploying">What happens when you deploy</h2>
          <ol>
            <li><strong>Detect and build.</strong> shipzy works out what kind of project it is (Vite, Create React App, or a static Next.js export), runs the install and build, and finds the output folder. If the project cannot be deployed, you get the reason before anything is built.</li>
            <li><strong>Upload.</strong> The output goes to a brand-new folder in S3, named <code>my-app/d-20261031T130907-a6373d/</code>. Nothing already in the bucket is touched.</li>
            <li><strong>Go live.</strong> The routing table entry for the hostname is pointed at the new folder. A failed deploy cleans up after itself and never changes what is live.</li>
            <li><strong>Record.</strong> The deploy is added to the project’s history, and old ones beyond the newest ten (that are not live) are removed.</li>
          </ol>
          <p>A <strong>remote</strong> or <strong>GitHub</strong> deploy does steps 1 and 2 inside CodeBuild, in your account, then asks the publish function to do steps 3 and 4. The webhook that starts a GitHub deploy checks GitHub’s signature before it does anything.</p>

          <h2 id="serving">How a visitor’s request is served</h2>
          <ol>
            <li>The request reaches CloudFront, and the router function runs at the edge.</li>
            <li>The router looks up the hostname in the routing table and gets something like <code>my-app/d-20261031T130907-a6373d</code>.</li>
            <li>It rewrites the path to that folder and S3 returns the file. Files with a hashed name are cached for a year; HTML is always revalidated.</li>
          </ol>
          <p>How a path maps to a file depends on the kind of site. A single-page app answers every path with <code>index.html</code>. A static Next.js export answers <code>/about</code> with <code>about.html</code>, and an unknown path gets a real 404 with the site’s own 404 page. Each deploy remembers which style it uses, so rolling back across the two kinds works.</p>

          <h2 id="rollback">Rollback, previews and domains</h2>
          <ul>
            <li><strong>Rollback</strong> points the hostname at an older folder. No build, no upload, and it takes effect at the edge in about 30 seconds.</li>
            <li><strong>Pull request previews</strong> are extra hostnames, such as <code>my-app-pr-12.preview.example.com</code>, served from a wildcard domain. They are rebuilt on every push and removed when the PR closes, and only PRs from the same repository are built.</li>
            <li><strong>Custom domains</strong> get a free ACM certificate and a distribution of their own. If the domain is in Route 53, the DNS records are created for you; otherwise you get the exact records to add.</li>
          </ul>

          <h2 id="not-yet">What it does not do yet</h2>
          <p>shipzy serves files. Server-rendered Next.js, API routes and long-running servers are not supported yet. They are on the roadmap, and the routing design already leaves room for them. See <Link href="/docs/limits">limits and roadmap</Link>.</p>

          <div className="callout" style={{ marginTop: 32 }}>
            <strong>Want the details?</strong> The <Link href="/docs/getting-started">documentation</Link> covers every command, and the <Link href="/security">security page</Link> explains what each part is allowed to do.
          </div>
        </div>
      </div>
    </>
  );
}
