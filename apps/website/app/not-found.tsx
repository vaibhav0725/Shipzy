import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container narrow page-head" style={{ textAlign: 'center', padding: '120px 0 140px' }}>
      <p className="kicker">404</p>
      <h1>This page could not be found</h1>
      <p style={{ margin: '16px auto 0' }}>It may have moved. Try the documentation, or start from the home page.</p>
      <div className="cta" style={{ justifyContent: 'center' }}>
        <Link className="btn primary" href="/docs/getting-started">Read the docs</Link>
        <Link className="btn" href="/">Home</Link>
      </div>
    </div>
  );
}
