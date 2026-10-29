'use client';

import Link from 'next/link';
import { ErrorNotice, StatusBadge } from '@/components/bits';
import { formatBytes, Status, timeAgo, useApi } from '@/lib/client';

export default function Overview() {
  const { data, error, loading, reload } = useApi<Status>('/api/status', { interval: 15000 });

  return (
    <>
      <div className="head">
        <div>
          <h1>Overview</h1>
          <p className="muted">Your AWS account, as the CLI sees it.</p>
        </div>
        <div className="row">
          <button onClick={() => void reload()}>Refresh</button>
          <Link className="btn primary" href="/projects/new">New deployment</Link>
        </div>
      </div>

      {loading && !data && <p className="muted">Loading...</p>}
      {error && !data && (
        <div className="notice bad">
          <strong>Could not read the stack.</strong> {error}
          {/not found/i.test(error) && (
            <p style={{ margin: '8px 0 0' }}>
              Create it from a terminal with <code>deployer init</code>, then refresh this page.
            </p>
          )}
        </div>
      )}

      {data && (
        <>
          <div className="grid">
            <div className="stat"><div className="n">{data.projects}</div><div className="muted">projects</div></div>
            <div className="stat"><div className="n">{data.liveSites}</div><div className="muted">live sites</div></div>
            <div className="stat"><div className="n">{data.deployments}</div><div className="muted">deployments stored</div></div>
            <div className="stat"><div className="n">{formatBytes(data.bytes)}</div><div className="muted">storage used</div></div>
          </div>

          <div className="card">
            <h2>Infrastructure</h2>
            <dl className="kv">
              <dt>Account</dt><dd>{data.account} <span className="muted">({data.identity})</span></dd>
              <dt>Region</dt><dd>{data.region ?? '-'}</dd>
              <dt>Stack</dt><dd>{data.stack.name} <StatusBadge status={data.stack.status} /></dd>
              <dt>Shared URL</dt><dd><a href={data.distribution.url} target="_blank" rel="noreferrer">{data.distribution.url}</a></dd>
              <dt>Bucket</dt><dd className="mono">{data.bucket}</dd>
              <dt>Remote builds</dt><dd>{data.builds.engine ? 'ready' : <>not set up: run <code>deployer init</code></>}</dd>
              <dt>GitHub</dt><dd>{data.githubProjects} project(s) deploy on push</dd>
              <dt>Last build</dt>
              <dd>
                {data.builds.last ? (
                  <>
                    <StatusBadge status={data.builds.last.status} /> {data.builds.last.project ?? '-'} · {timeAgo(data.builds.last.startedAt)} · {data.builds.last.took}
                  </>
                ) : (
                  'none yet'
                )}
              </dd>
            </dl>
          </div>
          <p className="muted small">
            The shared URL serves one project at a time: the last project deployed to it wins. Give each project its own
            domain from its <em>Domains</em> tab.
          </p>
        </>
      )}
      <ErrorNotice message={data ? error : undefined} />
    </>
  );
}
