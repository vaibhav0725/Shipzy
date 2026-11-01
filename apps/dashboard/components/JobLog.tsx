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
    let stopped = false;
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // A hosted dashboard cannot hold a connection open for a long job, so it asks for new lines every moment.
    const poll = async (from: number) => {
      if (stopped) return;
      let next = from;
      let done = false;
      try {
        const res = await fetch(`/api/jobs/${jobId}?from=${from}`, { cache: 'no-store' });
        if (res.ok) {
          const body = (await res.json()) as { lines: string[]; next: number; status: string; exitCode?: number | null };
          if (body.lines.length > 0) setLines((prev) => prev.concat(body.lines));
          next = body.next;
          if (body.status !== 'running') {
            done = true;
            onEndRef.current?.({ status: body.status as End['status'], exitCode: body.exitCode ?? null });
          }
        }
      } catch {
        /* try again on the next tick */
      }
      if (!done && !stopped) timer = setTimeout(() => void poll(next), 1500);
    };

    void (async () => {
      let hostedMode = false;
      try {
        hostedMode = ((await (await fetch('/api/mode', { cache: 'no-store' })).json()) as { hosted?: boolean }).hosted === true;
      } catch {
        /* assume local */
      }
      if (stopped) return;
      if (hostedMode) return void poll(0);
      start();
    })();

    function start() {
      source = new EventSource(`/api/jobs/${jobId}/stream`);
      const src = source;
      src.addEventListener('lines', (e) => {
        const { lines: chunk } = JSON.parse((e as MessageEvent).data) as { lines: string[] };
        setLines((prev) => prev.concat(chunk));
      });
      src.addEventListener('end', (e) => {
        src.close();
        onEndRef.current?.(JSON.parse((e as MessageEvent).data) as End);
      });
      // On a dropped connection EventSource would reconnect and replay from the start; stop instead.
      src.onerror = () => src.close();
    }

    return () => {
      stopped = true;
      source?.close();
      if (timer) clearTimeout(timer);
    };
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
