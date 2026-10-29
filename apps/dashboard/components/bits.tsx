'use client';

import { ReactNode, useState } from 'react';

export function Badge({ kind, children }: { kind?: 'ok' | 'bad' | 'warn'; children: ReactNode }) {
  return <span className={`badge ${kind ?? ''}`}>{children}</span>;
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
  return <Badge kind={kind}>{status.toLowerCase().replace(/_/g, ' ')}</Badge>;
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
