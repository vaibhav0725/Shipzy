import * as https from 'node:https';

export const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export class GithubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// node:https rather than fetch, so requests go through the same network settings as the AWS SDK calls.
function request<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: 'api.github.com',
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'deployer-cli',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: 20_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          let json: unknown;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {
            json = undefined;
          }
          if (status >= 200 && status < 300) return resolve(json as T);
          const message = (json as { message?: string } | undefined)?.message ?? text.slice(0, 200);
          reject(new GithubError(status, message));
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('GitHub did not respond in time.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export interface Repo {
  full_name: string;
  default_branch: string;
  private: boolean;
}

interface Hook {
  id: number;
  config?: { url?: string };
}

export const getRepo = (token: string, repo: string) => request<Repo>(token, 'GET', `/repos/${repo}`);

export async function headSha(token: string, repo: string, branch: string): Promise<string> {
  const commit = await request<{ sha: string }>(token, 'GET', `/repos/${repo}/commits/${encodeURIComponent(branch)}`);
  return commit.sha;
}

const hookConfig = (url: string, secret: string) => ({ url, content_type: 'json', secret, insecure_ssl: '0' });

/** Creates the webhook, or updates it in place if one for this URL already exists. */
export async function upsertWebhook(
  token: string,
  repo: string,
  url: string,
  secret: string,
  events: string[] = ['push'],
) {
  const hooks = await request<Hook[]>(token, 'GET', `/repos/${repo}/hooks?per_page=100`);
  const existing = hooks.find((h) => h.config?.url === url);
  if (existing) {
    await request(token, 'PATCH', `/repos/${repo}/hooks/${existing.id}`, {
      config: hookConfig(url, secret),
      events,
      active: true,
    });
    return { id: existing.id, created: false };
  }
  const hook = await request<Hook>(token, 'POST', `/repos/${repo}/hooks`, {
    name: 'web',
    active: true,
    events,
    config: hookConfig(url, secret),
  });
  return { id: hook.id, created: true };
}

export async function pingWebhook(token: string, repo: string, id: number): Promise<void> {
  await request(token, 'POST', `/repos/${repo}/hooks/${id}/pings`);
}

/** Removes the webhook for this URL. Returns false when there was none. */
export async function removeWebhook(token: string, repo: string, url: string): Promise<boolean> {
  const hooks = await request<Hook[]>(token, 'GET', `/repos/${repo}/hooks?per_page=100`);
  const existing = hooks.find((h) => h.config?.url === url);
  if (!existing) return false;
  await request(token, 'DELETE', `/repos/${repo}/hooks/${existing.id}`);
  return true;
}

/** A GitHub API failure in words a user can act on. */
export function explainGithubError(err: unknown, repo: string): Error {
  if (err instanceof GithubError) {
    if (err.status === 401) return new Error('GitHub rejected the token (expired, revoked or mistyped).');
    if (err.status === 404) return new Error(`Repository "${repo}" was not found, or the token cannot see it.`);
    return new Error(`GitHub said ${err.status}: ${err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export interface PullRequest {
  state: 'open' | 'closed';
  number: number;
  head: { sha: string; ref: string; repo: { full_name: string } | null };
  base: { ref: string };
}

export const getPullRequest = (token: string, repo: string, pr: number) =>
  request<PullRequest>(token, 'GET', `/repos/${repo}/pulls/${pr}`);

interface Comment {
  id: number;
  body?: string;
}

/**
 * Creates the one comment this tool keeps on a pull request, or edits it in place. The comment is found by a hidden
 * marker in its body, so repeated pushes update it instead of adding a new one each time.
 */
export async function upsertComment(token: string, repo: string, pr: number, marker: string, body: string): Promise<number> {
  const text = `${marker}\n${body}`;
  const comments = await request<Comment[]>(token, 'GET', `/repos/${repo}/issues/${pr}/comments?per_page=100`);
  const existing = comments.find((c) => c.body?.startsWith(marker));
  if (existing) {
    await request(token, 'PATCH', `/repos/${repo}/issues/comments/${existing.id}`, { body: text });
    return existing.id;
  }
  return (await request<Comment>(token, 'POST', `/repos/${repo}/issues/${pr}/comments`, { body: text })).id;
}
