'use client';

import { ReactNode, useEffect, useState } from 'react';
import { Icon, IconName } from '@/components/Icons';

export function Badge({ kind, children, dot, pulse }: { kind?: 'ok' | 'bad' | 'warn'; children: ReactNode; dot?: boolean; pulse?: boolean }) {
  return (
    <span className={`badge ${kind ?? ''}`}>
      {dot && <span className={`dot ${pulse ? 'pulse' : ''}`} />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status?: string }) {
  if (!status) return <Badge>-</Badge>;
  const s = status.toUpperCase();
  const kind = ['SUCCEEDED', 'ISSUED', 'OK', 'CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'].includes(s)
    ? 'ok'
    : ['FAILED', 'FAULT', 'TIMED_OUT', 'STOPPED', 'CANCELLED', 'ROLLBACK_COMPLETE'].some((x) => s.includes(x)) || s.endsWith('_FAILED')
      ? 'bad'
      : s.includes('PROGRESS') || s === 'PENDING' || s === 'RUNNING' || s.startsWith('PENDING')
        ? 'warn'
        : undefined;
  return (
    <Badge kind={kind} dot pulse={kind === 'warn'}>
      {status.toLowerCase().replace(/_/g, ' ')}
    </Badge>
  );
}

/** A coloured square with the project's first letter; the colour is derived from the name so it stays the same. */
export function Avatar({ name, large }: { name: string; large?: boolean }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className={`avatar ${large ? 'lg' : ''}`} style={{ ['--h' as string]: hash }} aria-hidden="true">
      {name.charAt(0)}
    </span>
  );
}

export function Skeleton({ width, height = 14 }: { width?: number | string; height?: number }) {
  return <span className="skel" style={{ display: 'block', width: width ?? '100%', height }} />;
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon"><Icon name={icon} /></div>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

/** Copies text to the clipboard and shows a tick for a moment. */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ghost small"
      title="Copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      <Icon name={done ? 'check' : 'copy'} />
      {label && (done ? 'Copied' : label)}
    </button>
  );
}

export function ErrorNotice({ message }: { message?: string }) {
  return message ? <div className="notice bad">{message}</div> : null;
}

/** A dialog that asks for confirmation; with `word`, the user must type it first (for destructive actions). */
export function Confirm(props: {
  title: string;
  children?: ReactNode;
  word?: string;
  action: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = !props.word || typed === props.word;
  const { onCancel } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="modal-back" onClick={props.onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={props.title}>
        <h2>{props.title}</h2>
        {props.children}
        {props.word && (
          <label className="field">
            <span>
              Type <code>{props.word}</code> to confirm
            </span>
            <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
          </label>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={props.onCancel}>Cancel</button>
          <button
            className={props.danger ? 'danger' : 'primary'}
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await props.onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {props.action}
          </button>
        </div>
      </div>
    </div>
  );
}
