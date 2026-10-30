'use client';

import Link from 'next/link';
import { EmptyState, StatusBadge } from '@/components/bits';
import { Icon } from '@/components/Icons';
import { JobInfo, timeAgo, useApi } from '@/lib/client';

export default function Activity() {
  const { data, error } = useApi<JobInfo[]>('/api/jobs', { interval: 3000 });
  return (
    <>
      <div className="head">
        <div>
          <h1>Activity</h1>
          <p className="sub">Everything you started from this dashboard, with its full output. Kept while the dashboard runs.</p>
        </div>
      </div>
      {error && <div className="notice bad">{error}</div>}
      {data && data.length === 0 && (
        <EmptyState icon="terminal" title="Nothing yet">
          <p>Deploys, rollbacks, domain changes and other actions you start here appear in this list, each with its log.</p>
          <Link className="btn primary" href="/projects/new">
            <Icon name="rocket" />
            New deployment
          </Link>
        </EmptyState>
      )}
      {data && data.length > 0 && (
        <div className="card tablewrap">
          <table>
            <thead><tr><th>Action</th><th>Project</th><th>Status</th><th>Started</th><th /></tr></thead>
            <tbody>
              {data.map((j) => (
                <tr key={j.id}>
                  <td><Link href={`/jobs/${j.id}`}><strong>{j.label}</strong></Link></td>
                  <td>{j.project ? <Link href={`/projects/${j.project}`}>{j.project}</Link> : <span className="muted">-</span>}</td>
                  <td><StatusBadge status={j.status} /></td>
                  <td className="nowrap muted">{timeAgo(j.startedAt)}</td>
                  <td className="actions"><Link href={`/jobs/${j.id}`}>Open log</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
