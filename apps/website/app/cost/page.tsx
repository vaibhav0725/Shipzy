import type { Metadata } from 'next';
import Link from 'next/link';
import Callout from '@/components/Callout';

export const metadata: Metadata = { title: 'Cost', description: 'What shipzy costs to run on AWS, with the arithmetic, and the situations where it is not the cheapest choice.' };

export default function Cost() {
  return (
    <>
      <div className="container narrow page-head">
        <h1>Cost</h1>
        <p>shipzy is free and open source. You pay AWS directly for what you use, and nothing on top. This page shows the arithmetic and is honest about where it is not the cheapest choice.</p>
      </div>

      <div className="container narrow page-body">
        <div className="prose">
          <Callout warn><strong>These are estimates.</strong> They use AWS list prices as we understand them at the time of writing, for the US East region. Prices and free allowances change, so check the AWS pricing pages before you rely on a number.</Callout>

          <h2 id="what">What you pay for</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Service</th><th>Used for</th><th>Roughly</th></tr></thead>
              <tbody>
                <tr><td>CloudFront</td><td>Serving your sites</td><td>First 1 TB and 10M requests a month are free; after that about $0.085 per GB and $1 per million requests</td></tr>
                <tr><td>Router (CloudFront Function and routing table)</td><td>Choosing which deploy to serve</td><td>About $0.16 per million requests, after a free allowance</td></tr>
                <tr><td>S3</td><td>Storing every deploy</td><td>About $0.023 per GB a month. Retention keeps it small</td></tr>
                <tr><td>Secrets Manager</td><td>GitHub token and webhook secret</td><td>$0.40 per secret a month, so about $0.80 fixed</td></tr>
                <tr><td>CodeBuild</td><td>Remote and GitHub builds</td><td>100 build minutes a month free, then about $0.005 a minute</td></tr>
                <tr><td>Route 53</td><td>DNS, only if you use it</td><td>$0.50 per hosted zone a month</td></tr>
                <tr><td>Certificates, Lambda, parameters, logs</td><td>Domains, publishing, variables</td><td>Free or fractions of a cent at this scale</td></tr>
              </tbody>
            </table>
          </div>
          <p>The only charges that exist when nothing is happening are the two secrets and, if you use it, the DNS zone: about $1 to $1.50 a month.</p>

          <h2 id="examples">Examples</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Situation</th><th>The arithmetic</th><th>About</th></tr></thead>
              <tbody>
                <tr><td>A few small sites, light traffic</td><td>Fixed $0.80 to $1.30. Traffic and builds stay inside the free allowances.</td><td><strong>$1 to $2</strong></td></tr>
                <tr><td>A team of five, previews on every pull request</td><td>Fixed about $1.30, plus roughly 750 build minutes (650 over the free 100, about $3).</td><td><strong>$2 to $5</strong></td></tr>
                <tr><td>A busy site with 10 TB of traffic a month</td><td>9 TB over the free 1 TB at about $0.085 per GB, plus requests.</td><td><strong>$700 to $800</strong></td></tr>
              </tbody>
            </table>
          </div>

          <h2 id="compared">Compared with the alternatives</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Situation</th><th>Per-seat hosted platforms</th><th>Free static hosts</th><th>shipzy on AWS</th></tr></thead>
              <tbody>
                <tr><td>Personal or hobby site</td><td>Free tiers, often non-commercial only</td><td>Free</td><td>About $1 to $2, so <strong>you will not save money here</strong></td></tr>
                <tr><td>Commercial site, small team</td><td>Typically a paid plan per person</td><td>Free</td><td>The same $1 to $5 however many people deploy</td></tr>
                <tr><td>Very high traffic</td><td>Usually overage charges on bandwidth</td><td>Free or cheap</td><td>AWS bandwidth pricing, usually cheaper than platform overage</td></tr>
              </tbody>
            </table>
          </div>
          <p>Where shipzy tends to save money: <strong>teams</strong> (no per-seat charge), <strong>high traffic</strong> (AWS bandwidth rates), <strong>companies with AWS credits or committed spend</strong>, and <strong>agencies</strong> hosting many client sites.</p>

          <h2 id="not-cheapest">When shipzy is not the right choice</h2>
          <ul>
            <li><strong>You want it free.</strong> Free static hosts exist, and shipzy does not beat free.</li>
            <li><strong>You do not want an AWS account.</strong> shipzy needs one, and setting it up takes longer than connecting a repository to a hosted platform.</li>
            <li><strong>You need server rendering today.</strong> shipzy serves static sites for now.</li>
          </ul>

          <h2 id="guardrails">Keeping the bill predictable</h2>
          <ul>
            <li>Create an <strong>AWS Budget</strong> alert for the account, so a spike emails you early. AWS has no hard spending cap.</li>
            <li>Retention is on by default: the newest ten deploys of each project are kept, plus anything live, so storage stays bounded.</li>
            <li>Small sites sit comfortably inside the CloudFront free allowance. A sudden increase in traffic is the thing to watch.</li>
          </ul>
          <p>A guided budget alarm and a command that shows what you have spent this month are planned. See <Link href="/docs/limits">limits and roadmap</Link>.</p>
        </div>
      </div>
    </>
  );
}
