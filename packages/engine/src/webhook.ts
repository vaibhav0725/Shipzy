import { createHmac, timingSafeEqual } from 'node:crypto';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import {
  buildEnvVars,
  DEFAULT_KEEP,
  listManifestProjects,
  newDeploymentId,
  readManifest,
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

const reply = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// Cached briefly so a rotated secret (`deployer github rotate-secret`) takes effect within minutes
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
  if (kind !== 'push') return reply(202, { ignored: `event "${kind}"` });

  let payload: PushPayload;
  try {
    payload = JSON.parse(rawBody) as PushPayload;
  } catch {
    return reply(400, { error: 'invalid JSON' });
  }
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
