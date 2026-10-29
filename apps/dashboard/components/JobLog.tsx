'use client';

import { useEffect, useRef, useState } from 'react';

type End = { status: 'succeeded' | 'failed' | 'cancelled'; exitCode: number | null };

/** Follows a job's output live (server-sent events). The server replays everything from the start on connect. */
export default function JobLog({ jobId, onEnd }: { jobId: string; onEnd?: (end: End) => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

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
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      className="log"
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {lines.length === 0 ? <span className="muted">Waiting for output...</span> : null}
      {lines.map((l, i) => (
        <div key={i} className={l.startsWith('$ ') ? 'cmd' : /^(Error|\[failed)/.test(l) ? 'err' : undefined}>
          {l || ' '}
        </div>
      ))}
    </div>
  );
}
