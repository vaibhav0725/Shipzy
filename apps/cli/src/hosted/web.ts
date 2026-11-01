import * as http from 'node:http';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { listJobs, readLog, readMeta, requestCancel, startJob, type JobInfo, type Step } from './store.js';

// The hosted dashboard's web function. It starts the dashboard's own Next.js server inside this process (so the
// dashboard code is the same as the local one), and turns each Lambda Function URL request into an HTTP request to
// it. The server reaches the jobs through `globalThis.__shipzyHosted`, so the dashboard package itself needs no AWS SDK.

const PORT = 3000;
const here = path.dirname(fileURLToPath(import.meta.url));

interface Bridge {
  startJob(opts: { label: string; project?: string; steps: Step[]; secrets?: string[] }): Promise<JobInfo>;
  listJobs(): Promise<JobInfo[]>;
  getJob(id: string): Promise<JobInfo | undefined>;
  readLog(id: string, from: number): ReturnType<typeof readLog>;
  cancelJob(id: string): Promise<boolean>;
}

let ready: Promise<void> | undefined;

// The sign-in details live in Secrets Manager. They are read at start-up, and again (at most every 10 seconds) while
// the OAuth App's id is still missing, so `shipzy dashboard --configure` takes effect without redeploying.
let lastSecretRead = 0;
async function loadSecret(): Promise<void> {
  const arn = process.env.SHIPZY_SECRET_ARN;
  if (!arn) throw new Error('SHIPZY_SECRET_ARN is not set.');
  lastSecretRead = Date.now();
  const res = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: arn }));
  const secret = JSON.parse(res.SecretString ?? '{}') as { sessionSecret?: string; githubClientId?: string; githubClientSecret?: string };
  process.env.SHIPZY_SESSION_SECRET = secret.sessionSecret ?? '';
  process.env.SHIPZY_OAUTH_CLIENT_ID = secret.githubClientId ?? '';
  process.env.SHIPZY_OAUTH_CLIENT_SECRET = secret.githubClientSecret ?? '';
}

async function boot(): Promise<void> {
  await loadSecret();

  const bridge: Bridge = {
    startJob,
    listJobs,
    getJob: readMeta,
    readLog,
    async cancelJob(id) {
      const meta = await readMeta(id);
      if (!meta || meta.status !== 'running') return false;
      await requestCancel(id);
      return true;
    },
  };
  (globalThis as unknown as { __shipzyHosted?: Bridge }).__shipzyHosted = bridge;

  process.env.PORT = String(PORT);
  process.env.HOSTNAME = '127.0.0.1';
  const require = createRequire(import.meta.url);
  require(path.join(here, 'app', 'apps', 'dashboard', 'server.js'));
  await waitForServer();
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 25_000;
  for (;;) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/auth/ping', method: 'GET', timeout: 1500 }, (r) => {
        r.resume();
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => req.destroy());
      req.end();
    });
    if (ok) return;
    if (Date.now() > deadline) throw new Error('The dashboard server did not start in time.');
    await new Promise((r) => setTimeout(r, 150));
  }
}

interface UrlEvent {
  rawPath: string;
  rawQueryString: string;
  headers: Record<string, string>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
}

interface UrlResult {
  statusCode: number;
  headers: Record<string, string>;
  cookies?: string[];
  body: string;
  isBase64Encoded: boolean;
}

const TEXT = /^(text\/|application\/(json|javascript|xml)|image\/svg)/;

export async function handler(event: UrlEvent): Promise<UrlResult> {
  try {
    ready ??= boot().catch((err) => {
      ready = undefined; // try again on the next request
      throw err;
    });
    await ready;
    if (!process.env.SHIPZY_OAUTH_CLIENT_ID && Date.now() - lastSecretRead > 10_000) await loadSecret();
  } catch (err) {
    console.error('start-up failed', err);
    return { statusCode: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, body: 'The dashboard is starting or misconfigured. Check the function logs.', isBase64Encoded: false };
  }

  const headers: Record<string, string> = { ...event.headers };
  if (event.cookies?.length) headers.cookie = event.cookies.join('; ');
  const body = event.body ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8') : undefined;
  if (body) headers['content-length'] = String(body.length);

  return new Promise<UrlResult>((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, method: event.requestContext.http.method, path: event.rawPath + (event.rawQueryString ? `?${event.rawQueryString}` : ''), headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const out: Record<string, string> = {};
          let cookies: string[] | undefined;
          for (const [name, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            if (name === 'set-cookie') cookies = Array.isArray(value) ? value : [value];
            else out[name] = Array.isArray(value) ? value.join(', ') : String(value);
          }
          delete out['transfer-encoding'];
          delete out.connection;
          const text = TEXT.test(out['content-type'] ?? '');
          resolve({ statusCode: res.statusCode ?? 502, headers: out, cookies, body: buf.toString(text ? 'utf8' : 'base64'), isBase64Encoded: !text });
        });
      },
    );
    req.on('error', (err) => resolve({ statusCode: 502, headers: { 'content-type': 'text/plain' }, body: `Bad gateway: ${err.message}`, isBase64Encoded: false }));
    if (body) req.write(body);
    req.end();
  });
}

