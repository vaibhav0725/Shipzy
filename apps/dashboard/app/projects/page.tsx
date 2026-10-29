'use client';

import Link from 'next/link';
import { ErrorNotice } from '@/components/bits';
import { formatBytes, ProjectSummary, siteUrl, timeAgo, useApi } from '@/lib/client';

export default function Projects() {
  const { data, error, loading, reload } = useApi<ProjectSummary[]>('/api/projects', { interval: 20000 });
  return (
    <>
      <div className="head">
        <div>
          <h1>Projects</h1>
          <p className="muted">Everything deployed to this stack.</p>
        </div>
        <div className="row">
          <button onClick={() => void reload()}>Refresh</button>
          <Link className="btn primary" href="/projects/new">New deployment</Link>
        </div>
      </div>
      <ErrorNotice message={error} />
      {loading && !data && <p className="muted">Loading...</p>}
      {data && data.length === 0 && (
        <div className="card">
          <p>No projects yet.</p>
          <Link className="btn primary" href="/projects/new">Deploy your first project</Link>
        </div>
      )}
      {data && data.length > 0 && (
        <div className="card tablewrap">
          <table>
            <thead>
              <tr><th>Project</th><th>Live on</th><th>Deployed</th><th>Auto-deploy from</th><th>Versions</th><th>Size</th></tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.name}>
                  <td><Link href={`/projects/${p.name}`}><strong>{p.name}</strong></Link></td>
                  <td>
                    {p.live.length === 0 ? <span className="muted">not live</span> : p.live.map((l) => (
                      <div key={l.host}><a href={siteUrl(l.host)} target="_blank" rel="noreferrer">{l.host}</a></div>
                    ))}
                  </td>
                  <td>{timeAgo(p.live[0]?.deployedAt ?? p.lastDeployedAt)}</td>
                  <td>{p.source ? `${p.source.repo}@${p.source.branch}` : <span className="muted">-</span>}</td>
                  <td>{p.versions}</td>
                  <td>{formatBytes(p.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
