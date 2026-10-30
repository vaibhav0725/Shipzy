import { randomUUID } from 'node:crypto';
import { InputError } from './validate';

// "Connect GitHub" uses GitHub's device flow: the dashboard shows a short code, the person approves it on
// github.com, and this server then holds the resulting token in memory (never on disk, never sent to the
// browser). It is only handed to the CLI, through an environment variable, when a project is connected.
// The OAuth App's client ID is public by design; no client secret is involved.

const OAUTH = process.env.DEPLOYER_GITHUB_OAUTH_URL ?? 'https://github.com';
const API = process.env.DEPLOYER_GITHUB_API_URL ?? 'https://api.github.com';

// repo: read repositories (private ones too) and manage their webhooks and pull request comments.
const SCOPE = 'repo';

interface Device {
  deviceCode: string;
  expiresAt: number;
  /** earliest time GitHub may be asked again */
  nextPollAt: number;
  interval: number;
}

interface Session {
  token: string;
  login: string;
}

// Next.js may load this module more than once; the login must be one shared state.
interface State {
  devices: Map<string, Device>;
  session?: Session;
}
const g = globalThis as unknown as { __deployerGithub?: State };
const state: State = (g.__deployerGithub ??= { devices: new Map<string, Device>() });

export const clientId = () => process.env.DEPLOYER_GITHUB_CLIENT_ID?.trim() || undefined;

export const sessionToken = (): string | undefined => state.session?.token;

export function sessionInfo(): { configured: boolean; connected: boolean; login?: string } {
  return { configured: Boolean(clientId()), connected: Boolean(state.session), login: state.session?.login };
}

export function forgetSession(): void {
  state.session = undefined;
}

async function call<T>(url: string, init: RequestInit & { token?: string }): Promise<{ status: number; body: T }> {
  const { token, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'deployer-dashboard',
      ...(token ? { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' } : {}),
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { status: res.status, body: body as T };
}

export async function startDevice() {
  const id = clientId();
  if (!id) throw new InputError('GitHub login is not set up: set DEPLOYER_GITHUB_CLIENT_ID (see the guide), or paste a token instead.');
  const { status, body } = await call<{
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
    error_description?: string;
  }>(`${OAUTH}/login/device/code`, { method: 'POST', body: JSON.stringify({ client_id: id, scope: SCOPE }) });
  if (!body?.device_code || !body.user_code || !body.verification_uri) {
    const why = body?.error === 'device_flow_disabled' ? 'Device flow is not enabled for that OAuth App (tick "Enable Device Flow" in its settings).' : body?.error_description || body?.error || `GitHub answered ${status}.`;
    throw new InputError(`Could not start the GitHub login: ${why}`);
  }
  // Forget logins that were never finished.
  for (const [key, d] of state.devices) if (d.expiresAt < Date.now()) state.devices.delete(key);
  const key = randomUUID();
  const interval = Math.max(5, body.interval ?? 5);
  state.devices.set(key, {
    deviceCode: body.device_code,
    expiresAt: Date.now() + (body.expires_in ?? 900) * 1000,
    nextPollAt: Date.now() + interval * 1000,
    interval,
  });
  return { id: key, userCode: body.user_code, verificationUri: body.verification_uri, expiresIn: body.expires_in ?? 900, interval };
}

export type PollResult =
  | { status: 'pending'; interval: number }
  | { status: 'done'; login: string }
  | { status: 'expired' }
  | { status: 'denied' };

export async function pollDevice(key: string): Promise<PollResult> {
  const device = state.devices.get(key);
  const id = clientId();
  if (!device || !id || device.expiresAt < Date.now()) {
    state.devices.delete(key);
    return { status: 'expired' };
  }
  // Never ask GitHub faster than it allows, however often the browser calls.
  if (Date.now() < device.nextPollAt) return { status: 'pending', interval: device.interval };

  const { body } = await call<{ access_token?: string; error?: string; interval?: number }>(`${OAUTH}/login/oauth/access_token`, {
    method: 'POST',
    body: JSON.stringify({ client_id: id, device_code: device.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
  });

  if (body?.access_token) {
    const me = await call<{ login?: string }>(`${API}/user`, { method: 'GET', token: body.access_token });
    state.devices.delete(key);
    state.session = { token: body.access_token, login: me.body?.login ?? 'GitHub user' };
    return { status: 'done', login: state.session.login };
  }
  switch (body?.error) {
    case 'authorization_pending':
      device.nextPollAt = Date.now() + device.interval * 1000;
      return { status: 'pending', interval: device.interval };
    case 'slow_down':
      device.interval = body.interval ?? device.interval + 5;
      device.nextPollAt = Date.now() + device.interval * 1000;
      return { status: 'pending', interval: device.interval };
    case 'access_denied':
      state.devices.delete(key);
      return { status: 'denied' };
    default:
      state.devices.delete(key);
      return { status: 'expired' };
  }
}

export interface RepoRow {
  repo: string;
  private: boolean;
  defaultBranch: string;
  description?: string;
  pushedAt?: string;
  /** the token may manage this repository's webhooks (needed to deploy on every push) */
  admin: boolean;
}

interface GithubRepo {
  full_name: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  pushed_at: string | null;
  archived?: boolean;
  permissions?: { admin?: boolean };
}

/** The repositories the signed-in person can see, most recently pushed first (at most 300). */
export async function listRepos(): Promise<RepoRow[]> {
  const token = state.session?.token;
  if (!token) throw new InputError('Connect GitHub first.');
  const rows: RepoRow[] = [];
  for (let page = 1; page <= 3; page++) {
    const { status, body } = await call<GithubRepo[] | { message?: string }>(
      `${API}/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
      { method: 'GET', token },
    );
    if (status === 401) {
      // The person revoked the app's access on github.com.
      forgetSession();
      throw new InputError('GitHub no longer accepts this login. Connect GitHub again.');
    }
    if (!Array.isArray(body)) throw new InputError(`GitHub answered ${status}: ${(body as { message?: string } | undefined)?.message ?? 'no repositories'}.`);
    for (const r of body) {
      if (r.archived) continue;
      rows.push({
        repo: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
        description: r.description ?? undefined,
        pushedAt: r.pushed_at ?? undefined,
        admin: Boolean(r.permissions?.admin),
      });
    }
    if (body.length < 100) break;
  }
  return rows;
}
