'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, ErrorNotice } from '@/components/bits';
import { api, timeAgo, useApi } from '@/lib/client';

export interface RepoRow {
  repo: string;
  private: boolean;
  defaultBranch: string;
  description?: string;
  pushedAt?: string;
  admin: boolean;
}

interface SessionInfo { configured: boolean; connected: boolean; login?: string }
interface DeviceInfo { id: string; userCode: string; verificationUri: string; expiresIn: number; interval: number }
type Poll = { status: 'pending'; interval: number } | { status: 'done'; login: string } | { status: 'expired' } | { status: 'denied' };

/**
 * "Connect GitHub": sign in with GitHub's device flow, then pick one of your repositories. `onSession` tells the
 * form whether a login is held by the dashboard (so it need not ask for a token); `onPick` fills in the repository.
 */
export default function GithubConnect(props: { selected: string; onSession: (connected: boolean) => void; onPick: (repo: RepoRow) => void }) {
  const session = useApi<SessionInfo>('/api/github/session');
  const [device, setDevice] = useState<DeviceInfo>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const repos = useApi<{ repos: RepoRow[] }>(session.data?.connected ? '/api/github/repos' : null);
  const { onSession } = props;

  useEffect(() => {
    if (session.data) onSession(session.data.connected);
  }, [session.data, onSession]);

  // While a code is waiting to be approved, ask whether it has been (at the pace GitHub allows).
  const reload = useRef(session.reload);
  reload.current = session.reload;
  useEffect(() => {
    if (!device) return;
    let stopped = false;
    let wait = Math.max(5, device.interval) * 1000;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await api<Poll>('/api/github/device/poll', { method: 'POST', body: JSON.stringify({ id: device.id }) });
        if (stopped) return;
        if (res.status === 'pending') {
          wait = Math.max(5, res.interval) * 1000;
          timer = setTimeout(tick, wait);
          return;
        }
        setDevice(undefined);
        if (res.status === 'done') await reload.current();
        else setError(res.status === 'denied' ? 'The login was cancelled on GitHub.' : 'The code expired. Try again.');
      } catch (err) {
        if (stopped) return;
        setDevice(undefined);
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    timer = setTimeout(tick, wait);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [device]);

  async function start() {
    setError(undefined);
    setBusy(true);
    try {
      setDevice(await api<DeviceInfo>('/api/github/device', { method: 'POST' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setError(undefined);
    try {
      await api('/api/github/session', { method: 'DELETE' });
      await session.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = repos.data?.repos ?? [];
    return (q ? all.filter((r) => r.repo.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q)) : all).slice(0, 50);
  }, [repos.data, filter]);

  if (!session.data) return null;

  // Not set up: the form falls back to pasting a token.
  if (!session.data.configured) {
    return (
      <p className="muted small">
        One-click GitHub login is not set up on this computer. Paste a token below, or see &quot;Connect GitHub&quot; in the guide to turn it on.
      </p>
    );
  }

  if (device) {
    return (
      <div className="notice">
        <p style={{ marginTop: 0 }}>
          1. Open{' '}
          <a href={device.verificationUri} target="_blank" rel="noreferrer">
            {device.verificationUri}
          </a>
          <br />
          2. Enter this code:
        </p>
        <p style={{ fontSize: 28, letterSpacing: 4, fontWeight: 700, margin: '4px 0 10px' }}>
          <code>{device.userCode}</code>
        </p>
        <div className="row">
          <span className="muted small">Waiting for you to approve it on GitHub...</span>
          <button type="button" className="small" onClick={() => setDevice(undefined)}>
            Cancel
          </button>
        </div>
        <ErrorNotice message={error} />
      </div>
    );
  }

  if (!session.data.connected) {
    return (
      <div className="field">
        <div className="row">
          <button type="button" className="primary" onClick={start} disabled={busy}>
            {busy ? 'Starting...' : 'Connect GitHub'}
          </button>
          <span className="muted small">Sign in on github.com once, then pick a repository from your list.</span>
        </div>
        <ErrorNotice message={error} />
      </div>
    );
  }

  return (
    <div className="field">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>
          <Badge kind="ok">connected</Badge> as <strong>{session.data.login}</strong>
        </span>
        <button type="button" className="small" onClick={disconnect}>
          Disconnect
        </button>
      </div>
      <ErrorNotice message={error ?? repos.error} />
      <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search your repositories" spellCheck={false} />
      <div className="tablewrap" style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
        {repos.loading ? (
          <p className="muted small" style={{ padding: 10 }}>Loading your repositories...</p>
        ) : shown.length === 0 ? (
          <p className="muted small" style={{ padding: 10 }}>No repository matches.</p>
        ) : (
          shown.map((r) => (
            <button
              type="button"
              key={r.repo}
              onClick={() => props.onPick(r)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                border: 0,
                borderBottom: '1px solid var(--line)',
                borderRadius: 0,
                background: r.repo === props.selected ? 'var(--accent-bg, var(--line))' : 'none',
              }}
            >
              <span className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <strong>{r.repo}</strong>
                <span className="row" style={{ flexWrap: 'nowrap' }}>
                  {r.private && <Badge>private</Badge>}
                  <span className="muted small">{timeAgo(r.pushedAt)}</span>
                </span>
              </span>
              {r.description && <span className="muted small">{r.description}</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
