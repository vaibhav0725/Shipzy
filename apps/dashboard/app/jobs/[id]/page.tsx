'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import JobLog from '@/components/JobLog';
import { Badge, ErrorNotice, StatusBadge } from '@/components/bits';
import { Icon } from '@/components/Icons';
import { api, JobInfo, useApi } from '@/lib/client';

/** The addresses a deploy printed ("Live: https://a, https://b"), so the finished page can offer to open them. */
function liveUrls(lines: string[]): string[] {
  const found = new Set<string>();
  for (const l of lines) {
    if (!l.startsWith('Live: ')) continue;
    for (const m of l.matchAll(/https:\/\/[^\s,()]+/g)) found.add(m[0]);
  }
  return [...found];
}

function took(job?: JobInfo): string | undefined {
  if (!job?.endedAt) return undefined;
  const secs = Math.max(0, Math.round((Date.parse(job.endedAt) - Date.parse(job.startedAt)) / 1000));
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const { data: job, error, reload } = useApi<JobInfo>(`/api/jobs/${id}?from=999999999`, { interval: 2000 });
  const [cancelError, setCancelError] = useState<string>();
  const [lines, setLines] = useState<string[]>([]);
  const urls = useMemo(() => liveUrls(lines), [lines]);
  const running = job?.status === 'running';

  return (
    <>
      <div className="crumbs">
        <Link href="/activity">Activity</Link>
        <span>/</span>
        <span>{job?.label ?? 'Job'}</span>
      </div>
      <div className="head">
        <div>
          <h1>{job?.label ?? 'Job'}</h1>
          <div className="row" style={{ marginTop: 8 }}>
            {job ? <StatusBadge status={job.status} /> : null}
            {took(job) && <span className="muted small">took {took(job)}</span>}
            {job?.project && <Link href={`/projects/${job.project}`} className="small">Open project</Link>}
          </div>
        </div>
        <div className="row">
          {running && (
            <button
              className="danger"
              onClick={() =>
                api(`/api/jobs/${id}/cancel`, { method: 'POST' })
                  .then(() => reload())
                  .catch((e) => setCancelError(e instanceof Error ? e.message : String(e)))
              }
            >
              Cancel
            </button>
          )}
          <Link className="btn" href="/activity">All activity</Link>
        </div>
      </div>
      <ErrorNotice message={error ?? cancelError} />

      {job && !running && (
        <div className={`notice ${job.status === 'succeeded' ? 'ok' : 'bad'}`}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>
              {job.status === 'succeeded' ? 'Finished successfully.' : job.status === 'cancelled' ? 'Cancelled.' : 'Failed. The last lines of the log say why.'}
            </strong>
            {job.status === 'succeeded' && urls.length > 0 && (
              <div className="row">
                {urls.slice(0, 3).map((u, i) => (
                  <a key={u} className={`btn small ${i === 0 ? 'primary' : ''}`} href={u} target="_blank" rel="noreferrer">
                    <Icon name="external" />
                    {u.replace('https://', '')}
                  </a>
                ))}
              </div>
            )}
          </div>
          {job.status === 'succeeded' && urls.length > 0 && <div className="small" style={{ marginTop: 6, color: 'var(--muted)' }}>A new address can take about 30 seconds to start answering everywhere.</div>}
        </div>
      )}
      {running && job.label.includes('(build in AWS)') && (
        <p className="muted small">Cancelling stops watching and the local process; a build already started in AWS keeps running.</p>
      )}
      {!error && <JobLog jobId={id} running={running} onEnd={() => void reload()} onLines={setLines} />}
    </>
  );
}
