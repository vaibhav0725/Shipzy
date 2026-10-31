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
        <img src={`/shots/${name}-light.png`} alt={caption} width={1360} height={1000} loading="lazy" />
      </a>
      <a className="dark" href={`/shots/${name}-dark.png`} target="_blank" rel="noopener">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/shots/${name}-dark.png`} alt={caption} width={1360} height={1000} loading="lazy" />
      </a>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

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

export default function Home() {
  return (
    <>
      {/* ---------------- Hero ---------------- */}
      <section className="hero">
        <div className="container">
          <div>
            <span className="eyebrow"><span className="dot" />Open source · early preview</span>
            <h1>
              Your own Vercel, in <span className="grad">your own AWS account.</span>
            </h1>
            <p className="lead">
              shipzy deploys React and Next.js sites to S3 and CloudFront in your AWS account, with instant rollbacks, preview URLs, custom
              domains and push-to-deploy. No servers of ours in the middle, and you pay AWS directly.
            </p>
            <InstallCommand command={site.install} />
            <div className="cta">
              <Link className="btn primary" href="/docs/getting-started">
                Get started <Icon name="arrow" />
              </Link>
              <Link className="btn" href="/how-it-works">How it works</Link>
            </div>
            <div className="trust">
              <span><Icon name="shield" />Runs in your account</span>
              <span><Icon name="lock" />Least-privilege access</span>
              <span><Icon name="eyeoff" />No telemetry</span>
              <span><Icon name="file" />{site.license}</span>
            </div>
          </div>

          <Terminal title="~/my-app">
            <Line at={300}><span className="t-cmd"><b>$</b> shipzy init</span></Line>
            <Line at={900}><span className="t-ok">✔</span> <span className="t-name">Ready.</span> <span className="t-dim">buckets, CDN, build project created</span></Line>
            <Line at={1300}> </Line>
            <Line at={1500}><span className="t-cmd"><b>$</b> shipzy deploy . --project my-app</span></Line>
            <Line at={2200}><span className="t-dim">›</span> Deploying <span className="t-name">my-app</span> (Next.js (static export))</Line>
            <Line at={2700}><span className="t-dim">›</span> Uploaded 142 files as <span className="t-dim">d-20261031T130907-a6373d</span></Line>
            <Line at={3200}> </Line>
            <Line at={3300}><span className="t-ok">✔</span> <span className="t-ok"><b>Live:</b></span> <span className="t-url">https://my-app.example.com</span></Line>
            <Line at={3800}> </Line>
            <Line at={4000}><span className="t-cmd"><b>$</b> shipzy rollback -p my-app</span></Line>
            <Line at={4600}><span className="t-ok">✔</span> <span className="t-name">my-app</span> now serves <span className="t-name">d-20261031T113335-fa4a01</span></Line>
          </Terminal>
        </div>
      </section>

      {/* ---------------- Three steps ---------------- */}
      <section className="section">
        <div className="container">
          <div className="section-head center">
            <span className="kicker">How it works</span>
            <h2>From zero to live in three commands</h2>
            <p>Everything is created in your AWS account, and you can see all of it in the AWS console.</p>
          </div>
          <div className="steps">
            <div className="step">
              <h3>Connect your AWS</h3>
              <p>One command creates the buckets, the CDN and the build project. It takes about five minutes, once.</p>
              <div className="snippet"><span className="c"># uses your AWS profile</span>{'\n'}<span className="k">$</span> shipzy init</div>
            </div>
            <div className="step">
              <h3>Deploy a project</h3>
              <p>Build on your machine or inside your account. Every deploy is stored as an immutable copy.</p>
              <div className="snippet"><span className="k">$</span> shipzy deploy ./my-app{'\n'}<span className="c"># or build in AWS</span>{'\n'}<span className="k">$</span> shipzy deploy ./my-app --remote</div>
            </div>
            <div className="step">
              <h3>Go live, go back</h3>
              <p>Pointing the site at a different deploy takes effect at the edge in about 30 seconds.</p>
              <div className="snippet"><span className="k">$</span> shipzy rollback -p my-app{'\n'}<span className="c"># or let every push deploy</span>{'\n'}<span className="k">$</span> shipzy github connect -p my-app</div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Features ---------------- */}
      <section className="section alt">
        <div className="container">
          <div className="section-head">
            <span className="kicker">What you get</span>
            <h2>The parts of Vercel you actually use</h2>
            <p>Deploys, previews, domains, rollbacks and environment variables, running on infrastructure you own.</p>
          </div>
          <div className="grid c3">
            {features.map((f) => (
              <div className="card" key={f.title}>
                <div className="ico"><Icon name={f.icon} /></div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Architecture ---------------- */}
      <section className="section">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Where it runs</span>
            <h2>Nothing runs on our servers</h2>
            <p>shipzy is a command-line tool on your machine and a set of resources in your AWS account. We never see your code, your keys or your traffic.</p>
          </div>
          <div className="card" style={{ padding: 28 }}><Diagram /></div>
          <div className="grid c3" style={{ marginTop: 18 }}>
            <div className="card"><h3 style={{ marginTop: 0 }}>Immutable deploys</h3><p>Each deploy is a new folder in S3. Nothing is overwritten, so a bad release never destroys the good one.</p></div>
            <div className="card"><h3 style={{ marginTop: 0 }}>A routing table at the edge</h3><p>CloudFront looks up which deploy a hostname should serve. Promote and rollback are one small write.</p></div>
            <div className="card"><h3 style={{ marginTop: 0 }}>Builds in your account</h3><p>CodeBuild runs your install and build, so GitHub deploys need no CI of their own and no secrets outside AWS.</p></div>
          </div>
          <p style={{ marginTop: 22 }}><Link href="/how-it-works">Read how it works in detail <Icon name="arrow" size={15} /></Link></p>
        </div>
      </section>

      {/* ---------------- Dashboard ---------------- */}
      <section className="section alt">
        <div className="container">
          <div className="split">
            <div>
              <span className="kicker">The dashboard</span>
              <h2 style={{ fontSize: 'clamp(30px, 3.6vw, 44px)', fontWeight: 740, letterSpacing: '-0.035em' }}>A calm place to see everything</h2>
              <p className="lead" style={{ marginTop: 16 }}>
                Prefer clicking to typing? <code>shipzy dashboard</code> opens a web UI that runs on your own computer. It does exactly what
                the CLI does, because it runs the CLI.
              </p>
              <ul className="checks">
                <li><Icon name="check" /><span><b>Deploy</b> from a folder or pick a GitHub repository</span></li>
                <li><Icon name="check" /><span><b>Roll back</b>, manage domains and variables, and follow build logs live</span></li>
                <li><Icon name="check" /><span><b>Optional:</b> it is a separate download, and the CLI works fully without it</span></li>
                <li><Icon name="check" /><span><b>Private:</b> it only listens on your own machine</span></li>
              </ul>
              <div className="cta">
                <Link className="btn" href="/docs/dashboard">Dashboard guide</Link>
              </div>
            </div>
            <Shot name="overview" caption="The overview: every project, its live address and its last deploy." />
          </div>
        </div>
      </section>

      {/* ---------------- Safety ---------------- */}
      <section className="section">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Safety</span>
            <h2>Built so you do not have to trust us</h2>
            <p>The safest design is one where we never hold anything worth stealing. A few of the choices that follow from that:</p>
          </div>
          <div className="grid c4">
            <div className="card"><div className="ico"><Icon name="server" /></div><h3>Your account only</h3><p>No shipzy servers, no accounts, no telemetry. The code runs on your machine and in your AWS.</p></div>
            <div className="card"><div className="ico"><Icon name="shield" /></div><h3>Least privilege</h3><p>A ready-made IAM policy limits the CLI to resources named for the stack. Download and read it.</p></div>
            <div className="card"><div className="ico"><Icon name="lock" /></div><h3>Secrets stay secret</h3><p>Tokens and variables go in encrypted stores, never in command lines or logs, and are never shown back.</p></div>
            <div className="card"><div className="ico"><Icon name="eyeoff" /></div><h3>Local dashboard</h3><p>Bound to 127.0.0.1 with a per-launch token, a host check and same-origin checks.</p></div>
          </div>
          <p style={{ marginTop: 22 }}><Link href="/security">Read the full security model <Icon name="arrow" size={15} /></Link></p>
        </div>
      </section>

      {/* ---------------- Cost ---------------- */}
      <section className="section alt">
        <div className="container">
          <div className="split rev">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Your situation</th><th>Typical monthly bill</th></tr></thead>
                <tbody>
                  <tr><td>A few small sites, light traffic</td><td>about $1 to $2</td></tr>
                  <tr><td>A team of five, previews on every PR</td><td>about $2 to $5 (no per-seat fee)</td></tr>
                  <tr><td>A busy site, 10 TB of traffic a month</td><td>roughly $700 (AWS bandwidth)</td></tr>
                </tbody>
              </table>
            </div>
            <div>
              <span className="kicker">Cost</span>
              <h2 style={{ fontSize: 'clamp(30px, 3.6vw, 44px)', fontWeight: 740, letterSpacing: '-0.035em' }}>You pay AWS, and nothing on top</h2>
              <p className="lead" style={{ marginTop: 16 }}>
                No per-seat pricing and no markup. Small sites mostly fit inside AWS free allowances. Estimates are based on AWS list prices at
                the time of writing, and the cost page shows the arithmetic and where shipzy is not the cheapest option.
              </p>
              <div className="cta"><Link className="btn" href="/cost">See the full breakdown</Link></div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Final CTA ---------------- */}
      <section className="band">
        <div className="container">
          <div className="band-card">
            <h2>Ship your first site in about ten minutes</h2>
            <p>Install the CLI, run one command to set up your account, and deploy.</p>
            <div style={{ display: 'flex', justifyContent: 'center' }}><InstallCommand command={site.install} /></div>
            <div className="cta">
              <Link className="btn primary" href="/docs/getting-started">Read the quickstart <Icon name="arrow" /></Link>
              <Link className="btn" href="/docs/cli-reference">CLI reference</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
