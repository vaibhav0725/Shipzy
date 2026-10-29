'use client';

import Link from 'next/link';
import { StatusBadge } from '@/components/bits';
import { JobInfo, timeAgo, useApi } from '@/lib/client';

export default function Activity() {
  const { data, error } = useApi<JobInfo[]>('/api/jobs', { interval: 3000 });
  return (
    <>
      <div className="head">
        <div>
          <h1>Activity</h1>
          <p className="muted">Actions started from this dashboard. Kept in memory while it runs.</p>
        </div>
      </div>
      {error && <div className="notice bad">{error}</div>}
      {data && data.length === 0 && <div className="card muted">Nothing yet.</div>}
      {data && data.length > 0 && (
        <div className="card tablewrap">
          <table>
            <thead><tr><th>Action</th><th>Project</th><th>Status</th><th>Started</th><th /></tr></thead>
            <tbody>
              {data.map((j) => (
                <tr key={j.id}>
                  <td>{j.label}</td>
                  <td>{j.project ? <Link href={`/projects/${j.project}`}>{j.project}</Link> : <span className="muted">-</span>}</td>
                  <td><StatusBadge status={j.status} /></td>
                  <td>{timeAgo(j.startedAt)}</td>
                  <td><Link href={`/jobs/${j.id}`}>Open log</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
