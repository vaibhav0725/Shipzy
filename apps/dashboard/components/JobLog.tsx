'use client';

import { useEffect, useRef, useState } from 'react';
import { CopyButton } from '@/components/bits';

type End = { status: 'succeeded' | 'failed' | 'cancelled'; exitCode: number | null };

const lineClass = (l: string) =>
  l.startsWith('$ ') ? 'cmd' : /^(Error|\[failed)/.test(l) ? 'err' : /^(Live:|Ready|Connected|Deleted|Destroyed|\[succeeded)/.test(l) ? 'ok' : /^(==>|\[Container\])/.test(l) ? 'dim' : undefined;

/** Follows a job's output live (server-sent events). The server replays everything from the start on connect. */
export default function JobLog({
  jobId,
  running,
  meta,
  onEnd,
  onLines,
}: {
  jobId: string;
  running?: boolean;
  /** extra words in the title bar, e.g. the kind of action */
  meta?: string;
  onEnd?: (end: End) => void;
  onLines?: (lines: string[]) => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  followRef.current = follow;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onLinesRef = useRef(onLines);
  onLinesRef.current = onLines;

  useEffect(() => {
    setLines([]);
    const source = new EventSource(`/api/jobs/${jobId}/stream`);
    source.addEventListener('lines', (e) => {
      const { lines: chunk } = JSON.parse((e as MessageEvent).data) as { lines: string[] };
      setLines((prev) => prev.concat(chunk));
    });
    source.addEventListener('end', (e) => {
      source.close();
      onEndRef.current?.(JSON.parse((e as MessageEvent).data) as End);
    });
    // On a dropped connection EventSource would reconnect and replay from the start; stop instead.
    source.onerror = () => source.close();
    return () => source.close();
  }, [jobId]);

  useEffect(() => {
    onLinesRef.current?.(lines);
    const el = box.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="term">
      <div className="term-bar">
        <span className={`dot ${running ? 'pulse' : ''}`} style={{ color: running ? 'var(--warn)' : 'var(--ok)' }} />
        <span className="t">{running ? 'Running' : 'Output'}</span>
        <span>· job {jobId}{meta ? ` · ${meta}` : ''}</span>
        <span className="spacer" />
        <button type="button" onClick={() => setFollow((f) => !f)} aria-pressed={follow}>
          {follow ? 'Following' : 'Follow'}
        </button>
        <CopyButton text={lines.join('\n')} label="Copy log" />
      </div>
      <div
        className="log"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          if (!atEnd && followRef.current) setFollow(false);
          if (atEnd && !followRef.current) setFollow(true);
        }}
      >
        {lines.length === 0 ? <div className="ln"><span className="no" /><span className="tx dim">Waiting for output...</span></div> : null}
        {lines.map((l, i) => (
          <div key={i} className="ln">
            <span className="no">{i + 1}</span>
            <span className={`tx ${lineClass(l) ?? ''}`}>{l || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
