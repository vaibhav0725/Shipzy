import Link from 'next/link';
import Diagram from '@/components/Diagram';
import { Icon, IconName } from '@/components/Icons';
import InstallCommand from '@/components/InstallCommand';
import { Line, Terminal } from '@/components/Terminal';
import { site } from '@/lib/site';

function Shot({ name, caption }: { name: string; caption: string }) {
  return (
    <figure className="shot">
      <a className="light" href={`/shots/${name}-light.png`} target="_blank" rel="noopener">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/shots/${name}-light.png`} alt={caption} width={1440} height={960} loading="lazy" />
      </a>
      <a className="dark" href={`/shots/${name}-dark.png`} target="_blank" rel="noopener">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/shots/${name}-dark.png`} alt={caption} width={1440} height={960} loading="lazy" />
      </a>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function SectionHead({ n, label, title, children }: { n: string; label: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <span className="label">{n} · {label}</span>
        <h2>{title}</h2>
      </div>
      {children && <p>{children}</p>}
    </div>
  );
}

const steps = [
  { t: 'Connect your AWS', p: 'One command creates the buckets, the CDN and the build project. It takes about five minutes, once.', code: ['# uses your AWS profile', '$ shipzy init'] },
  { t: 'Deploy a project', p: 'Build on your machine or inside your account. Every deploy is stored as an immutable copy.', code: ['$ shipzy deploy ./my-app', '# or build in AWS', '$ shipzy deploy ./my-app --remote'] },
  { t: 'Go live, go back', p: 'Pointing the site at a different deploy takes effect at the edge in about 30 seconds.', code: ['$ shipzy rollback -p my-app', '# or let every push deploy', '$ shipzy github connect -p my-app'] },
];

const features: { icon: IconName; title: string; text: string }[] = [
  { icon: 'rocket', title: 'Deploy from anywhere you work', text: 'A folder on your laptop, a build in your own AWS account, or a pasted GitHub link. Same result each time.' },
  { icon: 'branch', title: 'Push to deploy', text: 'Connect a repository once. Every push to the branch builds and goes live, with no CI to set up.' },
  { icon: 'pr', title: 'Preview every pull request', text: 'Each PR gets its own URL, rebuilt on every push and removed when the PR closes, with a comment on the PR.' },
  { icon: 'undo', title: 'Instant rollback', text: 'Every deploy is an immutable copy. Going back is a single small update, not a rebuild.' },
  { icon: 'globe', title: 'Custom domains with HTTPS', text: 'Certificate, distribution and DNS are created for you when the domain is in Route 53. Otherwise you get the exact records to add.' },
  { icon: 'key', title: 'Encrypted environment variables', text: 'Build-time variables are stored encrypted in your account, with separate production and preview values.' },
  { icon: 'layers', title: 'React and static Next.js', text: 'Vite, Create React App, and Next.js with output: export. Pages, dynamic routes and a real 404 all work.' },
  { icon: 'cloud', title: 'An address for every project', text: 'Each project gets its own CloudFront link on its first deploy, so any number of sites can be live at once.' },
  { icon: 'layout', title: 'An optional dashboard', text: 'A web UI that runs on your own computer: deploy, roll back, manage domains and variables, follow build logs.' },
];

const safety: { icon: IconName; title: string; text: string }[] = [
  { icon: 'server', title: 'Your account only', text: 'No shipzy servers, no accounts, no telemetry. The code runs on your machine and in your AWS.' },
  { icon: 'shield', title: 'Least privilege', text: 'A ready-made IAM policy limits the CLI to resources named for the stack. Download and read it.' },
  { icon: 'lock', title: 'Secrets stay secret', text: 'Tokens and variables go in encrypted stores, never in command lines or logs, and are never shown back.' },
  { icon: 'eyeoff', title: 'Local dashboard', text: 'Bound to 127.0.0.1 with a per-launch token, a host check and same-origin checks.' },
];

const checks = [
  { k: 'Deploy', v: 'from a folder or pick a GitHub repository' },
  { k: 'Roll back', v: 'manage domains and variables, and follow build logs live' },
  { k: 'Optional', v: 'a separate download; the CLI works fully without it' },
  { k: 'Private', v: 'it only listens on your own machine' },
];

const costs = [
  { s: 'A few small sites, light traffic', v: '$1–2', n: 'per month' },
  { s: 'A team of five, previews on every PR', v: '$2–5', n: 'no per-seat fee' },
  { s: 'A busy site, 10 TB of traffic a month', v: '~$700', n: 'AWS bandwidth' },
];

export default function Home() {
  return (
    <>
      {/* ---------------- Hero ---------------- */}
      <section className="hero">
        <div className="container">
          <div>
            <span className="eyebrow"><i />Open source · early preview</span>
            <h1>
              Your own Vercel, in <em>your own AWS account.</em>
            </h1>
            <p className="lead">
              shipzy deploys React and Next.js sites to S3 and CloudFront in your AWS account, with instant rollbacks, preview URLs, custom
              domains and push-to-deploy. No servers of ours in the middle, and you pay AWS directly.
            </p>
            <div className="cta">
              <InstallCommand command={site.install} />
              <Link className="btn primary" href="/docs/getting-started">
                Get started <Icon name="arrow" />
              </Link>
              <Link className="btn ghost" href="/how-it-works">How it works</Link>
            </div>
            <div className="trust">
              <span><Icon name="shield" />Runs in your account</span>
              <span><Icon name="lock" />Least-privilege access</span>
              <span><Icon name="eyeoff" />No telemetry</span>
              <span><Icon name="file" />{site.license}</span>
            </div>
          </div>

          <Terminal title="~/my-app">
            <Line at={300}><span className="t-cmd"><b>$ </b>shipzy init</span></Line>
            <Line at={900}><span className="t-ok">✔ </span><span className="t-name">Ready. </span><span className="t-dim">buckets, CDN, build project created</span></Line>
            <Line at={1300}> </Line>
            <Line at={1500}><span className="t-cmd"><b>$ </b>shipzy deploy . --project my-app</span></Line>
            <Line at={2200}><span className="t-dim">› </span>Deploying <span className="t-name">my-app </span><span className="t-dim">(Next.js static export)</span></Line>
            <Line at={2700}><span className="t-dim">› </span>Uploaded 142 files as <span className="t-dim">d-20261031T130907-a6373d</span></Line>
            <Line at={3200}><span className="t-ok">✔ </span><span className="t-url">Live: https://my-app.example.com</span></Line>
            <Line at={3700}> </Line>
            <Line at={3900}><span className="t-cmd"><b>$ </b>shipzy rollback -p my-app</span></Line>
            <Line at={4500}><span className="t-ok">✔ </span>my-app now serves <span className="t-dim">d-20261031T113335-fa4a01</span></Line>
          </Terminal>
        </div>
      </section>

      {/* ---------------- 01 How it works ---------------- */}
      <section className="section">
        <div className="container">
          <SectionHead n="01" label="How it works" title="From zero to live in three commands">
            Everything is created in your AWS account, and you can see all of it in the AWS console.
          </SectionHead>
          <div className="joined c3">
            {steps.map((s, i) => (
              <div className="cell" key={s.t}>
                <span className="n">{String(i + 1).padStart(2, '0')}</span>
                <h3>{s.t}</h3>
                <p>{s.p}</p>
                <div className="snippet">
                  {s.code.map((c) => (
                    <div key={c} className={c.startsWith('#') ? 'c' : undefined}>{c}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- 02 What you get ---------------- */}
      <section className="section alt">
        <div className="container">
          <SectionHead n="02" label="What you get" title="The parts of Vercel you actually use">
            Deploys, previews, domains, rollbacks and environment variables, running on infrastructure you own.
          </SectionHead>
          <div className="joined c3">
            {features.map((f, i) => (
              <div className="cell feature" key={f.title}>
                <div className="ico"><Icon name={f.icon} /><span>{String(i + 1).padStart(2, '0')}</span></div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- 03 Where it runs ---------------- */}
      <section className="section">
        <div className="container">
          <SectionHead n="03" label="Where it runs" title="Nothing runs on our servers">
            shipzy is a command-line tool on your machine and a set of resources in your AWS account. We never see your code, your keys or your traffic.
          </SectionHead>
          <div className="panel"><Diagram /></div>
          <div className="cols3">
            <div><h3>Immutable deploys</h3><p>Each deploy is a new folder in S3. Nothing is overwritten, so a bad release never destroys the good one.</p></div>
            <div><h3>A routing table at the edge</h3><p>CloudFront looks up which deploy a hostname should serve. Promote and rollback are one small write.</p></div>
            <div><h3>Builds in your account</h3><p>CodeBuild runs your install and build, so GitHub deploys need no CI of their own and no secrets outside AWS.</p></div>
          </div>
          <Link className="morelink" href="/how-it-works">Read how it works in detail →</Link>
        </div>
      </section>

      {/* ---------------- 04 The dashboard ---------------- */}
      <section className="section alt">
        <div className="container">
          <div className="split">
            <div>
              <span className="label">04 · The dashboard</span>
              <h2 style={{ marginTop: '0.875rem', font: 'var(--dw) clamp(1.75rem, 1.1rem + 2.2vw, 2.75rem) / 1.05 var(--display)', letterSpacing: 'var(--dls)' }}>A calm place to see everything</h2>
              <p className="lead" style={{ fontSize: '1.0625rem' }}>
                Prefer clicking to typing? <code className="inline">shipzy dashboard</code> opens a web UI that runs on your own computer. It does exactly what
                the CLI does, because it runs the CLI.
              </p>
              <div className="kvlist">
                {checks.map((c) => (
                  <div key={c.k}><span className="k">{c.k}</span><span className="v">{c.v}</span></div>
                ))}
              </div>
              <div className="cta">
                <Link className="btn" href="/docs/dashboard">Dashboard guide</Link>
              </div>
            </div>
            <Shot name="overview" caption="The overview: every project, its live address and its last deploy." />
          </div>
        </div>
      </section>

      {/* ---------------- 05 Safety ---------------- */}
      <section className="section">
        <div className="container">
          <SectionHead n="05" label="Safety" title="Built so you do not have to trust us">
            The safest design is one where we never hold anything worth stealing. A few of the choices that follow from that:
          </SectionHead>
          <div className="joined c4">
            {safety.map((s) => (
              <div className="cell feature" key={s.title}>
                <div className="ico"><Icon name={s.icon} /></div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
          <Link className="morelink" href="/security">Read the full security model →</Link>
        </div>
      </section>

      {/* ---------------- 06 Cost ---------------- */}
      <section className="section alt">
        <div className="container">
          <div className="split" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))' }}>
            <div>
              <span className="label">06 · Cost</span>
              <h2 style={{ marginTop: '0.875rem', font: 'var(--dw) clamp(1.75rem, 1.1rem + 2.2vw, 2.75rem) / 1.05 var(--display)', letterSpacing: 'var(--dls)' }}>You pay AWS, and nothing on top</h2>
              <p className="lead" style={{ fontSize: '1.0625rem' }}>
                No per-seat pricing and no markup. Small sites mostly fit inside AWS free allowances. Estimates are based on AWS list prices at
                the time of writing, and the cost page shows the arithmetic and where shipzy is not the cheapest option.
              </p>
              <Link className="morelink" href="/cost">See the full breakdown →</Link>
            </div>
            <div className="costbox">
              <div className="hd"><span>Your situation</span><span>Typical monthly bill</span></div>
              {costs.map((c) => (
                <div className="rw" key={c.s}>
                  <span>{c.s}</span>
                  <span><span className="big">{c.v}</span><small>{c.n}</small></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Final CTA ---------------- */}
      <section className="band">
        <div className="container">
          <div className="band-card">
            <div>
              <h2>Ship your first site in about ten minutes</h2>
              <p>Install the CLI, run one command to set up your account, and deploy.</p>
              <div className="cta">
                <Link className="btn primary" href="/docs/getting-started">Read the quickstart <Icon name="arrow" /></Link>
                <Link className="btn" href="/docs/cli-reference">CLI reference</Link>
              </div>
            </div>
            <div className="cmds">
              <div><b>$ </b>npm install -g shipzy</div>
              <div><b>$ </b>shipzy init</div>
              <div><b>$ </b>shipzy deploy ./my-app</div>
              <div className="dim"># ✔ Live: https://my-app.example.com</div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
