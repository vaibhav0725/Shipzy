'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Shapes of the CLI's `--json` output that the pages read.
export interface LiveHost { host: string; deploymentId: string; deployedAt?: string }
export interface ProjectSummary {
  name: string;
  live: LiveHost[];
  versions: number;
  lastDeployedAt?: string;
  bytes: number;
  files: number;
  source?: { repo: string; branch: string; previews: boolean };
  previews: number;
  domains: string[];
  envVars: number;
}
export interface Manifest {
  project: string;
  deployments: { id: string; createdAt: string; files: number; preview?: number }[];
  live: Record<string, string>;
  source?: { type: 'github'; repo: string; branch: string; host?: string; installCommand?: string; buildCommand?: string; previews?: boolean };
  env?: { production: string[]; preview: string[] };
  domains?: string[];
}
export interface Status {
  account: string;
  identity: string;
  region?: string;
  stack: { name: string; status: string; updated?: string };
  bucket: string;
  distribution: { id: string; url: string };
  builds: { project?: string; engine: boolean; webhookUrl?: string; last?: { status?: string; project?: string; startedAt?: string; took?: string } };
  githubProjects: number;
  projects: number;
  deployments: number;
  liveSites: number;
  bytes: number;
}
export interface DomainRow { host: string; project: string; stack: string; certificate: string; dns: string; distribution?: string }
export interface PreviewRow { project: string; pr: number; host: string; url: string; deployment: string; sha: string; updatedAt: string; serving: boolean }
export interface PreviewsInfo { bases: string[]; previews: PreviewRow[] }
export interface EnvRow { name: string; production: boolean; preview: boolean }
export interface BuildRow { build: string; id: string; project: string; status: string; source: string; deployment: string; startedAt?: string; duration: string }
export interface JobInfo { id: string; label: string; project?: string; status: 'running' | 'succeeded' | 'failed' | 'cancelled'; startedAt: string; endedAt?: string; exitCode?: number | null }

export class ApiError extends Error {}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init?.headers }, cache: 'no-store' });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiError(res.status === 401 ? 'Not signed in. Open the address that `deployer dashboard` printed.' : text.slice(0, 200) || `Request failed (${res.status})`);
  }
  if (!res.ok) throw new ApiError((data as { error?: string })?.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Starts an action as a background job. Resolves with the job; the caller usually navigates to /jobs/<id>. */
export const startAction = (body: Record<string, unknown>) =>
  api<JobInfo>('/api/jobs', { method: 'POST', body: JSON.stringify(body) });

export function useApi<T>(url: string | null, opts: { interval?: number } = {}) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(Boolean(url));
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!url) return;
    try {
      const next = await api<T>(url);
      if (!alive.current) return;
      setData(next);
      setError(undefined);
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    alive.current = true;
    setLoading(Boolean(url));
    setData(undefined);
    setError(undefined);
    void load();
    const timer = opts.interval ? setInterval(() => void load(), opts.interval) : undefined;
    return () => {
      alive.current = false;
      if (timer) clearInterval(timer);
    };
  }, [load, opts.interval, url]);

  return { data, error, loading, reload: load };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

export function timeAgo(iso?: string): string {
  if (!iso) return '-';
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export const siteUrl = (host: string) => `https://${host}`;
