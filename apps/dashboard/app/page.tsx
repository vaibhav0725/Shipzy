'use client';

import Link from 'next/link';
import { EmptyState, ErrorNotice, Skeleton, StatusBadge } from '@/components/bits';
import { Icon } from '@/components/Icons';
import ProjectCard from '@/components/ProjectCard';
import { formatBytes, ProjectSummary, Status, timeAgo, useApi } from '@/lib/client';

/** "46 MB" as a big number with a small unit. */
function Size({ bytes }: { bytes: number }) {
  const [n, unit] = formatBytes(bytes).split(' ');
  return (
    <>
      {n}
      <small>{unit}</small>
    </>
  );
}

export default function Overview() {
  const { data, error, reload } = useApi<Status>('/api/status', { interval: 15000 });
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
            <p style={{ margin: '0.5rem 0 0' }}>
              Create it from a terminal with <code>shipzy init</code>, then refresh this page.
            </p>
          )}
        </div>
      )}

      <div className="stats">
        {data ? (
          <>
            <div className="stat"><div className="l">Projects</div><div className="n">{data.projects}</div></div>
            <div className="stat"><div className="l">Live sites</div><div className="n">{data.liveSites}</div></div>
            <div className="stat"><div className="l">Deployments stored</div><div className="n">{data.deployments}</div></div>
            <div className="stat"><div className="l">Storage used</div><div className="n"><Size bytes={data.bytes} /></div></div>
          </>
        ) : (
          !error && [0, 1, 2, 3].map((i) => <div className="stat" key={i}><Skeleton width={70} height={12} /><div style={{ height: 10 }} /><Skeleton width={90} height={28} /></div>)
        )}
      </div>

      <div className="section">
        <h2>Recent projects</h2>
        {(projects.data?.length ?? 0) > 6 && <Link href="/projects">View all →</Link>}
      </div>
      <ErrorNotice message={projects.error} />
      {projects.loading && !projects.data && (
        <div className="cards">
          {[0, 1, 2].map((i) => <div className="pcard" key={i} style={{ padding: '1rem', gap: '0.75rem' }}><Skeleton height={34} /><Skeleton width="70%" /><Skeleton width="50%" /></div>)}
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
        <div className="cols" style={{ marginTop: '1.75rem' }}>
          <div className="panel">
            <div className="panel-head">
              <h2>Last build</h2>
              {data.builds.last && <StatusBadge status={data.builds.last.status} />}
            </div>
            {data.builds.last ? (
              <>
                <div className="kvrow"><span>Project</span><span>{data.builds.last.project ? <Link href={`/projects/${data.builds.last.project}`}>{data.builds.last.project}</Link> : '-'}</span></div>
                <div className="kvrow"><span>When</span><span>{timeAgo(data.builds.last.startedAt)}</span></div>
                <div className="kvrow"><span>Took</span><span>{data.builds.last.took ?? '-'}</span></div>
                <div className="kvrow"><span>GitHub</span><span>{data.githubProjects} project{data.githubProjects === 1 ? '' : 's'} deploy on push</span></div>
              </>
            ) : (
              <p className="note" style={{ border: 0 }}>No builds in AWS yet. Deploys from a GitHub repository, or with &quot;build in AWS&quot;, show up here.</p>
            )}
          </div>
          <div className="panel">
            <div className="panel-head"><h2>Infrastructure</h2><StatusBadge status={data.stack.status} /></div>
            <div className="kvrow"><span>Account</span><span>{data.account}</span></div>
            <div className="kvrow"><span>Region</span><span>{data.region ?? '-'}</span></div>
            <div className="kvrow"><span>Stack</span><span>{data.stack.name}</span></div>
            <div className="kvrow"><span>Remote builds</span><span style={{ color: data.builds.engine ? 'var(--ok)' : undefined }}>{data.builds.engine ? 'ready' : 'not set up: run shipzy init'}</span></div>
            <div className="kvrow"><span>Default URL</span><span><a href={data.distribution.url} target="_blank" rel="noreferrer">{data.distribution.url.replace('https://', '')}</a></span></div>
            <p className="note">Projects get their own address; the default URL only serves projects deployed to it earlier.</p>
          </div>
        </div>
      )}
    </>
  );
}
