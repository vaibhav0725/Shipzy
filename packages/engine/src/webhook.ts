import { createHmac, timingSafeEqual } from 'node:crypto';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import {
  buildEnvVars,
  DEFAULT_KEEP,
  listManifestProjects,
  newDeploymentId,
  previewLabel,
  readManifest,
  readPreviewBases,
  startBuild,
} from '@deployer/core';
import { env } from './env.js';

interface FunctionUrlEvent {
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

interface PushPayload {
  ref?: string;
  after?: string;
  deleted?: boolean;
  repository?: { full_name?: string };
}

interface PullRequestPayload {
  action?: string;
  number?: number;
  pull_request?: {
    number?: number;
    head?: { sha?: string; repo?: { full_name?: string } | null };
    base?: { ref?: string };
  };
  repository?: { full_name?: string };
}

const reply = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// Cached briefly so a rotated secret (`shipzy github rotate-secret`) takes effect within minutes
// without redeploying anything.
const SECRET_TTL_MS = 5 * 60_000;
let cached: { value: string; fetchedAt: number } | undefined;
async function webhookSecret(): Promise<string> {
  if (cached && Date.now() - cached.fetchedAt < SECRET_TTL_MS) return cached.value;
  const value = (await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: env('WEBHOOK_SECRET_ARN') })))
    .SecretString;
  if (!value) throw new Error('Webhook secret is empty');
  cached = { value, fetchedAt: Date.now() };
  return value;
}

function validSignature(secret: string, rawBody: string, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * GitHub push webhook (Lambda Function URL). The URL is public by design; the HMAC signature
 * is the only thing that lets a request start a build.
 */
export async function webhook(event: FunctionUrlEvent) {
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '');
  if (!validSignature(await webhookSecret(), rawBody, event.headers?.['x-hub-signature-256'])) {
    return reply(401, { error: 'invalid signature' });
  }

  const kind = event.headers?.['x-github-event'];
  if (kind === 'ping') return reply(200, { ok: true, message: 'pong' });
  if (kind !== 'push' && kind !== 'pull_request') return reply(202, { ignored: `event "${kind}"` });

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return reply(400, { error: 'invalid JSON' });
  }
  if (kind === 'pull_request') return pullRequest(parsed as PullRequestPayload);
  const payload = parsed as PushPayload;
  const repo = payload.repository?.full_name?.toLowerCase();
  const branch = payload.ref?.startsWith('refs/heads/') ? payload.ref.slice('refs/heads/'.length) : undefined;
  if (!repo || !branch || !payload.after || payload.deleted) return reply(202, { ignored: 'not a branch update' });

  const bucket = env('SITES_BUCKET');
  const started: { project: string; buildId: string }[] = [];
  for (const project of await listManifestProjects(bucket)) {
    const { source, env: projectEnv } = await readManifest(bucket, project);
    if (source?.type !== 'github' || source.repo.toLowerCase() !== repo || source.branch !== branch) continue;
    const buildId = await startBuild(env('BUILD_PROJECT'), {
      project,
      id: newDeploymentId(),
      hosts: source.host ? [source.host] : undefined,
      keep: DEFAULT_KEEP,
      source: { type: 'github', repo: payload.repository!.full_name!, sha: payload.after },
      installCommand: source.installCommand,
      buildCommand: source.buildCommand,
      env: buildEnvVars(env('STACK_NAME'), project, projectEnv, 'production'),
    });
    started.push({ project, buildId });
  }
  return reply(202, started.length ? { started } : { ignored: 'no project is connected to this repo and branch' });
}

const ACTIONS_THAT_BUILD = new Set(['opened', 'reopened', 'synchronize']);

/**
 * Pull request events. Opening or updating one builds a preview; closing it removes the preview.
 * Only pull requests from a branch of the same repository are built: a fork's code would otherwise run with this
 * project's build-time variables.
 */
async function pullRequest(payload: PullRequestPayload) {
  const repo = payload.repository?.full_name?.toLowerCase();
  const pr = payload.pull_request?.number ?? payload.number;
  const baseBranch = payload.pull_request?.base?.ref;
  if (!repo || !pr || !baseBranch || !payload.action) return reply(202, { ignored: 'not a pull request update' });

  const closing = payload.action === 'closed';
  if (!closing && !ACTIONS_THAT_BUILD.has(payload.action)) return reply(202, { ignored: `pull request action "${payload.action}"` });

  const sha = payload.pull_request?.head?.sha;
  const headRepo = payload.pull_request?.head?.repo?.full_name?.toLowerCase();
  if (!closing && (!sha || headRepo !== repo)) {
    return reply(202, { ignored: 'pull requests from forks are not built' });
  }

  const bucket = env('SITES_BUCKET');
  const results: { project: string; buildId?: string; removed?: boolean }[] = [];
  for (const project of await listManifestProjects(bucket)) {
    const { source, env: projectEnv } = await readManifest(bucket, project);
    if (source?.type !== 'github' || !source.previews || source.repo.toLowerCase() !== repo || source.branch !== baseBranch) continue;

    if (closing) {
      const res = await new LambdaClient({}).send(
        new InvokeCommand({
          FunctionName: env('ENGINE_FUNCTION'),
          Payload: Buffer.from(JSON.stringify({ action: 'preview-remove', project, pr })),
        }),
      );
      if (res.FunctionError) throw new Error(`Removing the preview of ${project}#${pr} failed: ${Buffer.from(res.Payload ?? []).toString('utf8')}`);
      results.push({ project, removed: true });
      continue;
    }

    if ((await readPreviewBases(bucket)).length === 0) return reply(202, { ignored: 'no preview domain is set up' });
    try {
      previewLabel(project, pr);
    } catch (err) {
      results.push({ project });
      console.warn((err as Error).message);
      continue;
    }
    const buildId = await startBuild(env('BUILD_PROJECT'), {
      project,
      id: newDeploymentId(),
      keep: DEFAULT_KEEP,
      source: { type: 'github', repo: payload.repository!.full_name!, sha: sha! },
      installCommand: source.installCommand,
      buildCommand: source.buildCommand,
      env: buildEnvVars(env('STACK_NAME'), project, projectEnv, 'preview'),
      preview: { pr },
    });
    results.push({ project, buildId });
  }
  return reply(202, results.length ? { previews: results } : { ignored: 'no project builds previews for this repository and branch' });
}
