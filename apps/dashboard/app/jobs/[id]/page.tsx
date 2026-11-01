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
      <div className="head" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1>{job?.label ?? 'Job'}</h1>
          <div className="row" style={{ marginTop: '0.625rem', gap: '0.75rem' }}>
            {job ? <StatusBadge status={job.status} /> : null}
            {took(job) && <span className="mono muted" style={{ fontSize: '0.78rem' }}>took {took(job)}</span>}
            {job?.project && <Link href={`/projects/${job.project}`} style={{ fontSize: '0.8125rem' }}>Open project →</Link>}
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
        <div className="resultcard">
          <span className={`ico ${job.status === 'succeeded' ? 'ok' : 'bad'}`}><Icon name={job.status === 'succeeded' ? 'check' : 'x'} /></span>
          <div className="msg">
            <b>{job.status === 'succeeded' ? 'Finished successfully.' : job.status === 'cancelled' ? 'Cancelled.' : 'Failed.'}</b>
            <div className="muted small">
              {job.status === 'succeeded'
                ? urls.length > 0 ? 'A new address can take about 30 seconds to start answering everywhere.' : 'The action completed.'
                : job.status === 'cancelled' ? 'The job stopped. A build that had already started in your AWS account carries on by itself and still deploys when it finishes.' : 'The last lines of the log say why.'}
            </div>
          </div>
          {job.status === 'succeeded' &&
            urls.slice(0, 3).map((u, i) => (
              <a key={u} className={`btn ${i === 0 ? 'primary' : ''}`} href={u} target="_blank" rel="noreferrer">
                {i === 0 && <Icon name="external" />}
                {u.replace('https://', '')}
              </a>
            ))}
        </div>
      )}
      {running && job.label.includes('(build in AWS)') && (
        <p className="muted small">Cancelling stops watching and the local process; a build already started in AWS keeps running.</p>
      )}
      {!error && <JobLog jobId={id} running={running} meta={job?.label.split(' ')[0]?.toLowerCase()} onEnd={() => void reload()} onLines={setLines} />}
    </>
  );
}
