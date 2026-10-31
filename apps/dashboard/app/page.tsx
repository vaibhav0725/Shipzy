'use client';

import Link from 'next/link';
import { EmptyState, ErrorNotice, Skeleton, StatusBadge } from '@/components/bits';
import { Icon } from '@/components/Icons';
import ProjectCard from '@/components/ProjectCard';
import { formatBytes, ProjectSummary, Status, timeAgo, useApi } from '@/lib/client';

export default function Overview() {
  const { data, error, loading, reload } = useApi<Status>('/api/status', { interval: 15000 });
  const projects = useApi<ProjectSummary[]>('/api/projects', { interval: 20000 });
  const recent = [...(projects.data ?? [])].sort((a, b) => Date.parse(b.lastDeployedAt ?? '0') - Date.parse(a.lastDeployedAt ?? '0')).slice(0, 6);

  return (
    <>
      <div className="head">
        <div>
          <h1>Overview</h1>
          <p className="sub">Your sites, running in your own AWS account.</p>
        </div>
        <div className="row">
          <button onClick={() => { void reload(); void projects.reload(); }}>
            <Icon name="refresh" />
            Refresh
          </button>
          <Link className="btn primary" href="/projects/new">
            <Icon name="plus" />
            New deployment
          </Link>
        </div>
      </div>

      {error && !data && (
        <div className="notice bad">
          <strong>Could not read the stack.</strong> {error}
          {/not found/i.test(error) && (
            <p style={{ margin: '8px 0 0' }}>
              Create it from a terminal with <code>shipzy init</code>, then refresh this page.
            </p>
          )}
        </div>
      )}

      <div className="grid">
        {data ? (
          <>
            <div className="stat"><div className="l">Projects</div><div className="n">{data.projects}</div></div>
            <div className="stat"><div className="l">Live sites</div><div className="n">{data.liveSites}</div></div>
            <div className="stat"><div className="l">Deployments stored</div><div className="n">{data.deployments}</div></div>
            <div className="stat"><div className="l">Storage used</div><div className="n">{formatBytes(data.bytes)}</div></div>
          </>
        ) : (
          !error && [0, 1, 2, 3].map((i) => <div className="stat" key={i}><Skeleton width={70} height={12} /><div style={{ height: 8 }} /><Skeleton width={90} height={26} /></div>)
        )}
      </div>

      <div className="section">
        <h2>Recent projects</h2>
        {(projects.data?.length ?? 0) > 6 && <Link href="/projects">View all {projects.data!.length}</Link>}
      </div>
      <ErrorNotice message={projects.error} />
      {projects.loading && !projects.data && (
        <div className="cards">
          {[0, 1, 2].map((i) => <div className="pcard" key={i}><Skeleton height={38} /><Skeleton width="70%" /><Skeleton width="50%" /></div>)}
        </div>
      )}
      {projects.data && projects.data.length === 0 && (
        <EmptyState icon="rocket" title="Deploy your first project">
          <p>Point it at a folder on this computer or at a GitHub repository. It goes live on its own address in your AWS account.</p>
          <Link className="btn primary" href="/projects/new">New deployment</Link>
        </EmptyState>
      )}
      {recent.length > 0 && <div className="cards">{recent.map((p) => <ProjectCard key={p.name} project={p} />)}</div>}

      {data && (
        <div className="cols" style={{ marginTop: 28 }}>
          <div className="card">
            <div className="card-head"><h2>Last build</h2></div>
            {data.builds.last ? (
              <dl className="kv">
                <dt>Result</dt><dd><StatusBadge status={data.builds.last.status} /></dd>
                <dt>Project</dt><dd>{data.builds.last.project ? <Link href={`/projects/${data.builds.last.project}`}>{data.builds.last.project}</Link> : '-'}</dd>
                <dt>When</dt><dd>{timeAgo(data.builds.last.startedAt)}</dd>
                <dt>Took</dt><dd>{data.builds.last.took ?? '-'}</dd>
                <dt>GitHub</dt><dd>{data.githubProjects} project{data.githubProjects === 1 ? '' : 's'} deploy on push</dd>
              </dl>
            ) : (
              <p className="muted">No builds in AWS yet. Deploys from a GitHub repository, or with &quot;build in AWS&quot;, show up here.</p>
            )}
          </div>
          <div className="card">
            <div className="card-head"><h2>Infrastructure</h2><StatusBadge status={data.stack.status} /></div>
            <dl className="kv">
              <dt>Account</dt><dd className="mono">{data.account}</dd>
              <dt>Region</dt><dd>{data.region ?? '-'}</dd>
              <dt>Stack</dt><dd>{data.stack.name}</dd>
              <dt>Remote builds</dt><dd>{data.builds.engine ? 'ready' : <>not set up: run <code>shipzy init</code></>}</dd>
              <dt>Default URL</dt>
              <dd>
                <a href={data.distribution.url} target="_blank" rel="noreferrer">{data.distribution.url.replace('https://', '')}</a>
                <div className="muted small">Projects get their own address; this one only serves projects deployed to it earlier.</div>
              </dd>
            </dl>
          </div>
        </div>
      )}
      {loading && !data && null}
    </>
  );
}
