'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EmptyState, ErrorNotice, Skeleton } from '@/components/bits';
import { Icon } from '@/components/Icons';
import ProjectCard from '@/components/ProjectCard';
import { ProjectSummary, useApi } from '@/lib/client';

export default function Projects() {
  const { data, error, loading, reload } = useApi<ProjectSummary[]>('/api/projects', { interval: 20000 });
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = data ?? [];
    if (!q) return all;
    return all.filter((p) => [p.name, p.source?.repo ?? '', ...p.live.map((l) => l.host), ...p.domains].some((t) => t.toLowerCase().includes(q)));
  }, [data, query]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Projects</h1>
          <p className="sub">{data ? `${data.length} project${data.length === 1 ? '' : 's'} in this stack.` : 'Everything deployed to this stack.'}</p>
        </div>
        <div className="row">
          <button onClick={() => void reload()}>
            <Icon name="refresh" />
            Refresh
          </button>
          <Link className="btn primary" href="/projects/new">
            <Icon name="plus" />
            New deployment
          </Link>
        </div>
      </div>

      <ErrorNotice message={error} />
      {data && data.length > 3 && (
        <div className="row" style={{ marginBottom: 16 }}>
          <label className="search">
            <Icon name="search" />
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, repository or address" spellCheck={false} />
          </label>
        </div>
      )}
      {loading && !data && (
        <div className="cards">
          {[0, 1, 2].map((i) => <div className="pcard" key={i}><Skeleton height={38} /><Skeleton width="70%" /><Skeleton width="50%" /></div>)}
        </div>
      )}
      {data && data.length === 0 && (
        <EmptyState icon="layers" title="No projects yet">
          <p>Deploy a React project from a folder or a GitHub repository. Each project gets its own address.</p>
          <Link className="btn primary" href="/projects/new">Deploy your first project</Link>
        </EmptyState>
      )}
      {data && data.length > 0 && shown.length === 0 && <p className="muted">Nothing matches &quot;{query}&quot;.</p>}
      {shown.length > 0 && <div className="cards">{shown.map((p) => <ProjectCard key={p.name} project={p} />)}</div>}
    </>
  );
}
