'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import JobLog from '@/components/JobLog';
import { ErrorNotice, StatusBadge } from '@/components/bits';
import { api, JobInfo, useApi } from '@/lib/client';

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const { data: job, error, reload } = useApi<JobInfo>(`/api/jobs/${id}?from=999999999`, { interval: 2000 });
  const [cancelError, setCancelError] = useState<string>();

  return (
    <>
      <div className="head">
        <div>
          <h1>{job?.label ?? 'Job'}</h1>
          <p className="muted">
            {job ? <StatusBadge status={job.status} /> : null}{' '}
            {job?.project && <Link href={`/projects/${job.project}`}>Open project</Link>}
          </p>
        </div>
        <div className="row">
          {job?.status === 'running' && (
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
      {job?.status === 'running' && job.label.includes('(build in AWS)') && (
        <p className="muted small">Cancelling stops watching and the local process; a build already started in AWS keeps running.</p>
      )}
      {!error && <JobLog jobId={id} onEnd={() => void reload()} />}
      {job && job.status !== 'running' && (
        <div className={`notice ${job.status === 'succeeded' ? 'ok' : 'bad'}`} style={{ marginTop: 14 }}>
          {job.status === 'succeeded' ? 'Finished successfully.' : job.status === 'cancelled' ? 'Cancelled.' : 'Failed. The last lines of the log say why.'}
        </div>
      )}
    </>
  );
}
