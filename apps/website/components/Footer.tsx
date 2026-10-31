import Link from 'next/link';
import { site } from '@/lib/site';
import { Logo } from './Icons';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div>
          <Link href="/" className="brand" style={{ marginBottom: 12 }}>
            <Logo />
            {site.name}
          </Link>
          <p style={{ maxWidth: 280 }}>Deploy React and Next.js sites to your own AWS account. Open source, and nothing runs on our servers.</p>
        </div>
        <div>
          <h4>Product</h4>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/security">Security</Link>
          <Link href="/cost">Cost</Link>
          <Link href="/docs/dashboard">Dashboard</Link>
        </div>
        <div>
          <h4>Docs</h4>
          <Link href="/docs/getting-started">Getting started</Link>
          <Link href="/docs/deploying">Deploying</Link>
          <Link href="/docs/nextjs">Next.js</Link>
          <Link href="/docs/cli-reference">CLI reference</Link>
        </div>
        <div>
          <h4>Project</h4>
          {site.repoUrl && <a href={site.repoUrl}>GitHub</a>}
          <a href={site.npmUrl}>npm</a>
          <Link href="/docs/limits">Limits and roadmap</Link>
          <Link href="/docs/troubleshooting">Troubleshooting</Link>
          <span style={{ display: 'block', padding: '3px 0' }}>License: {site.license}</span>
        </div>
        <div className="fine">
          <span>© {new Date().getFullYear()} shipzy. AWS, Amazon S3, CloudFront and Route 53 are trademarks of Amazon.com, Inc.; shipzy is not affiliated with Amazon or Vercel.</span>
          <span>Early preview</span>
        </div>
      </div>
    </footer>
  );
}
