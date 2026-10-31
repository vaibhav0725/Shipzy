'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { Avatar, Badge, Confirm, CopyButton, ErrorNotice, StatusBadge } from '@/components/bits';
import { Icon } from '@/components/Icons';
import { BuildRow, DomainRow, EnvRow, frameworkLabel, Manifest, PreviewsInfo, siteUrl, startAction, timeAgo, useApi } from '@/lib/client';

type Tab = 'deployments' | 'domains' | 'environment' | 'github' | 'previews' | 'builds';
const TABS: { id: Tab; label: string }[] = [
  { id: 'deployments', label: 'Deployments' },
  { id: 'domains', label: 'Domains' },
  { id: 'environment', label: 'Environment' },
  { id: 'github', label: 'GitHub' },
  { id: 'previews', label: 'Previews' },
  { id: 'builds', label: 'Builds' },
];

export default function ProjectPage() {
  const { name } = useParams<{ name: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('deployments');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const manifest = useApi<Manifest>(`/api/projects/${name}`, { interval: 15000 });

  // /projects/<name>?tab=domains opens that tab, and the address follows the tab you are on.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab');
    if (TABS.some((t) => t.id === wanted)) setTab(wanted as Tab);
  }, []);
  const choose = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, '', `?tab=${t}`);
  };

  const liveHosts = Object.keys(manifest.data?.live ?? {});

  async function run(body: Record<string, unknown>) {
    setError(undefined);
    try {
      const job = await startAction({ project: name, ...body });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const m = manifest.data;
  const domains = m?.domains ?? [];
  // The address to open: a custom domain first, then the project's own address, then whatever it is live on.
  const primary = liveHosts.find((h) => domains.includes(h)) ?? (m?.siteHost && liveHosts.includes(m.siteHost) ? m.siteHost : undefined) ?? liveHosts[0];
  const latest = m?.deployments.filter((d) => d.preview === undefined).at(-1);
  const counts: Partial<Record<Tab, number>> = {
    domains: domains.length,
    environment: new Set([...(m?.env?.production ?? []), ...(m?.env?.preview ?? [])]).size,
    previews: Object.keys(m?.previews ?? {}).length,
  };

  return (
    <>
      <div className="crumbs">
        <Link href="/projects">Projects</Link>
        <span>/</span>
        <span>{name}</span>
      </div>
      <div className="head">
        <div className="row" style={{ gap: 14, flexWrap: 'nowrap' }}>
          <Avatar name={name} large />
          <div>
            <h1>{name}</h1>
            <div className="row" style={{ marginTop: 6 }}>
              {m ? (
                <Badge kind={liveHosts.length ? 'ok' : undefined} dot>
                  {liveHosts.length ? 'Live' : 'Offline'}
                </Badge>
              ) : null}
              {frameworkLabel(latest?.framework) && <Badge>{frameworkLabel(latest?.framework)}</Badge>}
              {m?.source && (
                <a className="small muted row" style={{ gap: 5 }} href={`https://github.com/${m.source.repo}`} target="_blank" rel="noreferrer">
                  <Icon name="github" size={14} />
                  {m.source.repo} · {m.source.branch}
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="row">
          {primary && (
            <a className="btn primary" href={siteUrl(primary)} target="_blank" rel="noreferrer">
              <Icon name="external" />
              Visit
            </a>
          )}
          <Link className="btn" href={`/projects/new?project=${name}`}>
            <Icon name="rocket" />
            Deploy new version
          </Link>
          <button className="danger" onClick={() => setDeleting(true)}>
            <Icon name="trash" />
            Delete
          </button>
        </div>
      </div>

      <ErrorNotice message={error ?? manifest.error} />

      {m && (
        <div className="strip">
          <div>
            <div className="l">{liveHosts.length > 1 ? 'Live addresses' : 'Live address'}</div>
            {liveHosts.length === 0 ? (
              <div className="v muted">Not live</div>
            ) : (
              liveHosts.slice(0, 2).map((h) => (
                <div className="v row" key={h} style={{ flexWrap: 'nowrap', gap: 2 }}>
                  <a href={siteUrl(h)} target="_blank" rel="noreferrer" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{h}</a>
                  <CopyButton text={siteUrl(h)} />
                </div>
              ))
            )}
          </div>
          <div>
            <div className="l">Source</div>
            <div className="v">{m.source ? <>Pushes to <span className="mono">{m.source.branch}</span></> : <span className="muted">Manual deploys</span>}</div>
          </div>
          <div>
            <div className="l">Last deployed</div>
            <div className="v">{latest ? timeAgo(latest.createdAt) : '-'}</div>
          </div>
          <div>
            <div className="l">Versions</div>
            <div className="v">{m.deployments.filter((d) => d.preview === undefined).length}</div>
          </div>
        </div>
      )}

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => choose(t.id)}>
            {t.label}
            {counts[t.id] ? <> <span className="count">{counts[t.id]}</span></> : null}
          </button>
        ))}
      </div>

      {tab === 'deployments' && <Deployments name={name} manifest={manifest.data} run={run} />}
      {tab === 'domains' && <Domains name={name} siteHost={m?.siteHost} run={run} />}
      {tab === 'environment' && <Environment name={name} run={run} />}
      {tab === 'github' && <Github name={name} manifest={manifest.data} run={run} />}
      {tab === 'previews' && <Previews name={name} manifest={manifest.data} run={run} />}
      {tab === 'builds' && <Builds name={name} run={run} />}

      {deleting && (
        <Confirm
          title={`Delete ${name}?`}
          word={name}
          action="Delete project"
          danger
          onCancel={() => setDeleting(false)}
          onConfirm={() => run({ action: 'delete-project' })}
        >
          <p>
            This removes every deployment, its history, uploaded sources, environment variables and custom domains, and takes
            the GitHub webhook off the repository. If the project is live, the site stops working. It cannot be undone.
          </p>
        </Confirm>
      )}
    </>
  );
}

type Run = (body: Record<string, unknown>) => Promise<void>;

function Deployments({ name, manifest, run }: { name: string; manifest?: Manifest; run: Run }) {
  const [rollback, setRollback] = useState<string>();
  const [pruning, setPruning] = useState(false);
  const liveOf = new Map<string, string[]>();
  for (const [host, id] of Object.entries(manifest?.live ?? {})) liveOf.set(id, [...(liveOf.get(id) ?? []), host]);
  const rows = [...(manifest?.deployments ?? [])].reverse();

  return (
    <>
      <div className="card tablewrap">
        <table>
          <thead><tr><th>Deployment</th><th>Created</th><th>Files</th><th>Live on</th><th /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="mono">{d.id}{d.preview !== undefined && <> <Badge>preview #{d.preview}</Badge></>}</td>
                <td>{timeAgo(d.createdAt)}</td>
                <td>{d.files}</td>
                <td>{(liveOf.get(d.id) ?? []).map((h) => <div key={h}><Badge kind="ok">live</Badge> {h}</div>)}</td>
                <td className="actions">{!liveOf.has(d.id) && <button className="small" onClick={() => setRollback(d.id)}>Serve this one</button>}</td>
              </tr>
            ))}
            {manifest && rows.length === 0 && <tr><td colSpan={5} className="emptycell">No deployments yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button onClick={() => void run({ action: 'prune', dryRun: true })}>Preview cleanup</button>
        <button onClick={() => setPruning(true)}>Clean up old deployments</button>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        Deployments are immutable. Serving an older one is instant and applies to all of the project&apos;s hosts. The newest 10
        are kept, plus any that are live.
      </p>
      {rollback && (
        <Confirm title="Serve this deployment?" action="Serve it" onCancel={() => setRollback(undefined)} onConfirm={() => run({ action: 'rollback', to: rollback })}>
          <p>
            <span className="mono">{rollback}</span> will go live on all of {name}&apos;s hosts within about 30 seconds.
          </p>
        </Confirm>
      )}
      {pruning && (
        <Confirm title="Clean up old deployments?" action="Clean up" onCancel={() => setPruning(false)} onConfirm={() => run({ action: 'prune' })}>
          <p>Deletes deployments beyond the newest 10, and uploads that were never promoted. Live deployments are never deleted.</p>
        </Confirm>
      )}
    </>
  );
}

function Domains({ name, siteHost, run }: { name: string; siteHost?: string; run: Run }) {
  const { data, error, loading } = useApi<DomainRow[]>(`/api/projects/${name}/domains`, { interval: 20000 });
  const [host, setHost] = useState('');
  const [manual, setManual] = useState(false);
  const [removing, setRemoving] = useState<string>();

  return (
    <>
      <ErrorNotice message={error} />
      <div className="card tablewrap">
        <table>
          <thead><tr><th>Domain</th><th>Distribution</th><th>Certificate</th><th>DNS</th><th /></tr></thead>
          <tbody>
            {data?.map((d) => (
              <tr key={d.host}>
                <td><a href={siteUrl(d.host)} target="_blank" rel="noreferrer">{d.host}</a></td>
                <td><StatusBadge status={d.stack} /></td>
                <td><StatusBadge status={d.certificate} /></td>
                <td><StatusBadge status={d.dns} /></td>
                <td className="actions">
                  <div className="row">
                    <button className="small" onClick={() => void run({ action: 'domain-verify', host: d.host })}>Check</button>
                    <button className="small danger" onClick={() => setRemoving(d.host)}>Remove</button>
                  </div>
                </td>
              </tr>
            ))}
            {data?.length === 0 && <tr><td colSpan={5} className="emptycell">No custom domains yet. {siteHost ? <>The project is served at its own address, <span className="mono">{siteHost}</span>.</> : 'The project is served at a CloudFront address.'}</td></tr>}
            {loading && !data && <tr><td colSpan={5} className="emptycell">Loading...</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Add a domain</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run({ action: 'domain-add', host, manual });
          }}
        >
          <label className="field">
            <span>Hostname</span>
            <input type="text" value={host} onChange={(e) => setHost(e.target.value)} placeholder="app.example.com" spellCheck={false} required />
            <small>
              If a Route 53 zone for this domain is in your account, the certificate and DNS records are created for you. Otherwise
              the exact records are printed in the log for you to add. This takes 5 to 15 minutes.
            </small>
          </label>
          <label className="check">
            <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
            <span>I will add the DNS records myself (do not touch Route 53)</span>
          </label>
          <button className="primary" disabled={!host.trim()}>Add domain</button>
        </form>
      </div>

      {removing && (
        <Confirm title={`Remove ${removing}?`} word={removing} action="Remove domain" danger onCancel={() => setRemoving(undefined)} onConfirm={() => run({ action: 'domain-rm', host: removing })}>
          <p>Removes its route, distribution and certificate, and the DNS records this tool created. Records you added by hand stay and are listed in the log.</p>
        </Confirm>
      )}
    </>
  );
}

function Environment({ name, run }: { name: string; run: Run }) {
  const { data, error, loading } = useApi<EnvRow[]>(`/api/projects/${name}/env`, { interval: 20000 });
  const [varName, setVarName] = useState('');
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState(false);
  const [content, setContent] = useState('');
  const [importPreview, setImportPreview] = useState(false);

  return (
    <>
      <div className="notice warn small">
        These are <strong>build-time</strong> variables for builds in AWS (and GitHub pushes). They apply to the <em>next</em> build, not to
        what is live. Anything your framework exposes to the browser (<code>VITE_*</code>, <code>REACT_APP_*</code>) ends up in public
        JavaScript, so do not store secrets there. Values are never shown here.
      </div>
      <ErrorNotice message={error} />
      <div className="card tablewrap">
        <table>
          <thead><tr><th>Name</th><th>Production</th><th>Preview override</th><th /></tr></thead>
          <tbody>
            {data?.map((r) => (
              <tr key={r.name}>
                <td className="mono">{r.name}</td>
                <td>{r.production ? <Badge kind="ok">set</Badge> : '-'}</td>
                <td>{r.preview ? <Badge kind="ok">set</Badge> : '-'}</td>
                <td className="actions">
                  <div className="row">
                    {r.production && <button className="small danger" onClick={() => void run({ action: 'env-rm', name: r.name })}>Remove</button>}
                    {r.preview && <button className="small danger" onClick={() => void run({ action: 'env-rm', name: r.name, preview: true })}>Remove preview</button>}
                  </div>
                </td>
              </tr>
            ))}
            {data?.length === 0 && <tr><td colSpan={4} className="emptycell">No variables yet.</td></tr>}
            {loading && !data && <tr><td colSpan={4} className="emptycell">Loading...</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Set a variable</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run({ action: 'env-set', name: varName, value, preview });
          }}
        >
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <label className="field" style={{ flex: 1 }}>
              <span>Name</span>
              <input type="text" value={varName} onChange={(e) => setVarName(e.target.value)} placeholder="VITE_API_URL" spellCheck={false} required />
            </label>
            <label className="field" style={{ flex: 2 }}>
              <span>Value</span>
              <input type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" required />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
            <span>Preview builds only (overrides the production value there)</span>
          </label>
          <button className="primary" disabled={!varName.trim() || !value}>Save variable</button>
        </form>
      </div>

      <div className="card">
        <h2>Import a .env file</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run({ action: 'env-import', content, preview: importPreview });
          }}
        >
          <label className="field">
            <span>Paste the file&apos;s contents</span>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} placeholder={'VITE_API_URL=https://api.example.com\nVITE_GREETING=hello'} />
          </label>
          <label className="check">
            <input type="checkbox" checked={importPreview} onChange={(e) => setImportPreview(e.target.checked)} />
            <span>Import as preview-only overrides</span>
          </label>
          <button disabled={!content.trim()}>Import</button>
        </form>
      </div>
    </>
  );
}

function Github({ name, manifest, run }: { name: string; manifest?: Manifest; run: Run }) {
  const source = manifest?.source;
  const [disconnecting, setDisconnecting] = useState(false);
  if (!manifest) return <p className="muted">Loading...</p>;
  if (!source) {
    return (
      <div className="card">
        <p>This project is not connected to a GitHub repository.</p>
        <Link className="btn primary" href={`/projects/new?project=${name}&source=github`}>Connect a repository</Link>
      </div>
    );
  }
  return (
    <>
      <div className="card">
        <dl className="kv">
          <dt>Repository</dt><dd><a href={`https://github.com/${source.repo}`} target="_blank" rel="noreferrer">{source.repo}</a></dd>
          <dt>Branch</dt><dd>{source.branch}</dd>
          <dt>Deploys to</dt><dd>{source.host ?? ((manifest.domains ?? []).join(', ') || manifest.siteHost || 'its own CloudFront address')}</dd>
          <dt>Install command</dt><dd>{source.installCommand ?? <span className="muted">detected</span>}</dd>
          <dt>Build command</dt><dd>{source.buildCommand ?? <span className="muted">detected</span>}</dd>
          <dt>Pull request previews</dt><dd>{source.previews ? 'on' : <span className="muted">off (see the Previews tab)</span>}</dd>
        </dl>
        <p className="muted small" style={{ marginTop: 10 }}>Every push to {source.branch} builds in your AWS account and goes live.</p>
        <div className="row">
          <button className="primary" onClick={() => void run({ action: 'github-deploy' })}>Build the current head now</button>
          <button className="danger" onClick={() => setDisconnecting(true)}>Disconnect</button>
        </div>
      </div>
      {disconnecting && (
        <Confirm title="Disconnect from GitHub?" action="Disconnect" danger onCancel={() => setDisconnecting(false)} onConfirm={() => run({ action: 'github-disconnect' })}>
          <p>Pushes stop deploying this project and the webhook is removed (unless another project uses the same repository). Existing deployments stay.</p>
        </Confirm>
      )}
    </>
  );
}

function Builds({ name, run }: { name: string; run: Run }): ReactNode {
  const { data, error, loading } = useApi<BuildRow[]>(`/api/projects/${name}/builds`, { interval: 10000 });
  return (
    <>
      <ErrorNotice message={error} />
      <div className="card tablewrap">
        <table>
          <thead><tr><th>Build</th><th>Status</th><th>Source</th><th>Deployment</th><th>Started</th><th>Took</th><th /></tr></thead>
          <tbody>
            {data?.map((b) => (
              <tr key={b.id}>
                <td className="mono">{b.build}</td>
                <td><StatusBadge status={b.status} /></td>
                <td>{b.source}</td>
                <td className="mono">{b.deployment}</td>
                <td>{timeAgo(b.startedAt)}</td>
                <td>{b.duration}</td>
                <td><button className="small" onClick={() => void run({ action: 'build-logs', build: b.build })}>Log</button></td>
              </tr>
            ))}
            {data?.length === 0 && <tr><td colSpan={7} className="emptycell">No builds in AWS yet. Local builds do not appear here.</td></tr>}
            {loading && !data && <tr><td colSpan={7} className="emptycell">Loading...</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Previews({ name, manifest, run }: { name: string; manifest?: Manifest; run: Run }) {
  const { data, error, loading } = useApi<PreviewsInfo>(`/api/projects/${name}/previews`, { interval: 15000 });
  const [host, setHost] = useState('');
  const [manual, setManual] = useState(false);
  const [removing, setRemoving] = useState<number>();
  const source = manifest?.source;
  const hasDomain = (data?.bases.length ?? 0) > 0;

  return (
    <>
      <ErrorNotice message={error} />
      <div className="card">
        <h2>Pull request previews</h2>
        <p className="muted small">
          Each open pull request into the connected branch gets its own address (<span className="mono">{name}-pr-&lt;number&gt;.&lt;preview domain&gt;</span>),
          rebuilt on every push and removed when the pull request is closed. A link is posted on the pull request.
        </p>
        {!source && <p>Connect this project to a GitHub repository first (GitHub tab).</p>}
        {source && (
          <div className="row">
            <Badge kind={source.previews ? 'ok' : undefined}>{source.previews ? 'on' : 'off'}</Badge>
            {source.previews ? (
              <button onClick={() => void run({ action: 'github-previews', enable: false })}>Turn off</button>
            ) : (
              <button className="primary" disabled={!hasDomain} onClick={() => void run({ action: 'github-previews', enable: true })}>Turn on</button>
            )}
            {!hasDomain && !source.previews && <span className="muted small">Add a preview domain below first.</span>}
          </div>
        )}
        <p className="muted small" style={{ marginTop: 8 }}>
          Only pull requests from a branch of the same repository are built. Preview builds receive the project&apos;s production
          variables, with any preview-only values laid over them. The GitHub token needs &quot;Pull requests: Read and write&quot; so the
          comment can be posted.
        </p>
      </div>

      <div className="card tablewrap">
        <table>
          <thead><tr><th>Pull request</th><th>Address</th><th>Commit</th><th>Updated</th><th /></tr></thead>
          <tbody>
            {data?.previews.map((p) => (
              <tr key={p.pr}>
                <td>
                  {source ? <a href={`https://github.com/${source.repo}/pull/${p.pr}`} target="_blank" rel="noreferrer">#{p.pr}</a> : `#${p.pr}`}
                </td>
                <td><a href={p.url} target="_blank" rel="noreferrer">{p.host}</a> {!p.serving && <Badge kind="warn">not served</Badge>}</td>
                <td className="mono">{p.sha.slice(0, 7)}</td>
                <td>{timeAgo(p.updatedAt)}</td>
                <td><button className="small danger" onClick={() => setRemoving(p.pr)}>Remove</button></td>
              </tr>
            ))}
            {data && data.previews.length === 0 && <tr><td colSpan={5} className="emptycell">No open previews.</td></tr>}
            {loading && !data && <tr><td colSpan={5} className="emptycell">Loading...</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Preview domain</h2>
        {hasDomain ? (
          <p>Previews are served on {data!.bases.map((b) => <span key={b} className="mono">*.{b} </span>)}</p>
        ) : (
          <>
            <p className="muted small">
              One wildcard domain serves the previews of every project. It needs a certificate and a distribution of its own, like a
              custom domain (5 to 15 minutes), and its DNS can live in Route 53 or elsewhere.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run({ action: 'preview-domain-add', host, manual });
              }}
            >
              <label className="field">
                <span>Wildcard domain</span>
                <input type="text" value={host} onChange={(e) => setHost(e.target.value)} placeholder="*.preview.example.com" spellCheck={false} required />
              </label>
              <label className="check">
                <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
                <span>I will add the DNS records myself (do not touch Route 53)</span>
              </label>
              <button className="primary" disabled={!host.trim()}>Add preview domain</button>
            </form>
          </>
        )}
      </div>

      {removing !== undefined && (
        <Confirm title={`Remove the preview of #${removing}?`} action="Remove preview" danger onCancel={() => setRemoving(undefined)} onConfirm={() => run({ action: 'preview-rm', pr: removing })}>
          <p>Takes its address down and deletes its files. A new push to the pull request builds it again.</p>
        </Confirm>
      )}
    </>
  );
}
