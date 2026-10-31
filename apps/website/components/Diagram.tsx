/** Where everything runs: you on the left, your own AWS account in the middle, your visitors on the right. */
export default function Diagram() {
  return (
    <svg className="diagram" viewBox="0 0 970 430" role="img" aria-label="You deploy with the CLI or by pushing to GitHub. Everything runs in your own AWS account: S3 stores the sites, CloudFront serves them, Lambda and CodeBuild build and publish. Visitors only talk to CloudFront.">
      <defs>
        <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10Z" className="head" />
        </marker>
      </defs>

      {/* the zone */}
      <rect className="zone" x="215" y="18" width="570" height="394" rx="22" />
      <text x="240" y="48" className="lbl" style={{ fontSize: 13, letterSpacing: '0.08em' }}>YOUR AWS ACCOUNT</text>

      {/* you */}
      <rect className="box" x="20" y="70" width="150" height="100" rx="14" />
      <text x="95" y="115" textAnchor="middle">You</text>
      <text x="95" y="137" textAnchor="middle" className="sub">CLI or dashboard</text>
      <rect className="box" x="20" y="260" width="150" height="100" rx="14" />
      <text x="95" y="305" textAnchor="middle">GitHub</text>
      <text x="95" y="327" textAnchor="middle" className="sub">push or pull request</text>

      {/* inside the account */}
      <rect className="box" x="250" y="70" width="210" height="100" rx="14" />
      <text x="355" y="115" textAnchor="middle">S3 bucket</text>
      <text x="355" y="137" textAnchor="middle" className="sub">every deploy, immutable</text>
      <rect className="box" x="540" y="70" width="210" height="100" rx="14" />
      <text x="645" y="115" textAnchor="middle">CloudFront</text>
      <text x="645" y="137" textAnchor="middle" className="sub">edge router + routing table</text>
      <rect className="box" x="250" y="260" width="210" height="100" rx="14" />
      <text x="355" y="305" textAnchor="middle">Lambda</text>
      <text x="355" y="327" textAnchor="middle" className="sub">webhook + publish</text>
      <rect className="box" x="540" y="260" width="210" height="100" rx="14" />
      <text x="645" y="305" textAnchor="middle">CodeBuild</text>
      <text x="645" y="327" textAnchor="middle" className="sub">builds in your account</text>

      {/* visitors */}
      <rect className="box" x="810" y="70" width="140" height="100" rx="14" />
      <text x="880" y="115" textAnchor="middle">Visitors</text>
      <text x="880" y="137" textAnchor="middle" className="sub">over HTTPS</text>

      {/* arrows */}
      <path className="arrow" d="M170 120 H248" markerEnd="url(#ah)" />
      <text x="209" y="104" textAnchor="middle" className="lbl">deploy</text>
      <path className="arrow" d="M170 310 H248" markerEnd="url(#ah)" />
      <text x="209" y="294" textAnchor="middle" className="lbl">push</text>
      <path className="arrow" d="M460 310 H538" markerEnd="url(#ah)" />
      <text x="499" y="298" textAnchor="middle" className="lbl">build</text>
      <path className="arrow dash" d="M580 258 C 560 215, 500 200, 452 172" markerEnd="url(#ah)" />
      <text x="553" y="212" textAnchor="middle" className="lbl">upload</text>
      <path className="arrow" d="M538 120 H462" markerEnd="url(#ah)" />
      <text x="499" y="108" textAnchor="middle" className="lbl">reads</text>
      <path className="arrow" d="M810 120 H752" markerEnd="url(#ah)" />
    </svg>
  );
}
