import {
  assertProjectName,
  DEFAULT_KEEP,
  listManifestProjects,
  newDeploymentId,
  readManifest,
  startBuild,
  updateManifest,
} from '@deployer/core';
import { getOutputs, GlobalOptions, StackOutputs } from '../lib/aws.js';
import {
  getRepo,
  GithubError,
  headSha,
  pingWebhook,
  REPO_RE,
  removeWebhook,
  upsertWebhook,
} from '../lib/github.js';
import { promptHidden } from '../lib/prompt.js';
import { getSecret, putSecret } from '../lib/secrets.js';
import { watchBuild } from '../lib/watch.js';

interface GithubStack {
  buildProject: string;
  webhookUrl: string;
  webhookSecretArn: string;
  githubTokenSecretArn: string;
}

function githubStack(out: StackOutputs): GithubStack {
  const { buildProject, webhookUrl, webhookSecretArn, githubTokenSecretArn } = out;
  if (!buildProject || !webhookUrl || !webhookSecretArn || !githubTokenSecretArn) {
    throw new Error('This stack has no GitHub support yet. Run `deployer init` to add it.');
  }
  return { buildProject, webhookUrl, webhookSecretArn, githubTokenSecretArn };
}

function explain(err: unknown, repo: string): Error {
  if (err instanceof GithubError) {
    if (err.status === 401) return new Error('GitHub rejected the token (expired, revoked or mistyped).');
    if (err.status === 404) return new Error(`Repository "${repo}" was not found, or the token cannot see it.`);
    return new Error(`GitHub said ${err.status}: ${err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

async function readToken(): Promise<string> {
  const token = process.env.GITHUB_TOKEN?.trim() || (await promptHidden('GitHub token (input hidden): '));
  if (!token) throw new Error('A GitHub token is required (set GITHUB_TOKEN or type it when asked).');
  return token;
}

export interface ConnectOptions {
  project: string;
  repo: string;
  branch?: string;
  host?: string;
  installCommand?: string;
  buildCommand?: string;
  reuseToken?: boolean;
}

export async function connect(opts: ConnectOptions, global: GlobalOptions): Promise<void> {
  assertProjectName(opts.project);
  if (!REPO_RE.test(opts.repo)) throw new Error(`"${opts.repo}" is not a repository; use owner/name.`);
  const out = await getOutputs(global.stackName);
  const stack = githubStack(out);

  const token = opts.reuseToken ? await getSecret(stack.githubTokenSecretArn) : await readToken();
  let repo;
  try {
    repo = await getRepo(token, opts.repo);
  } catch (err) {
    throw explain(err, opts.repo);
  }
  const branch = opts.branch ?? repo.default_branch;
  if (!opts.reuseToken) await putSecret(stack.githubTokenSecretArn, token);

  // The webhook secret is created by the stack; GitHub signs every delivery with it.
  const webhookSecret = await getSecret(stack.webhookSecretArn);
  let webhookNote: string;
  try {
    const hook = await upsertWebhook(token, repo.full_name, stack.webhookUrl, webhookSecret);
    await pingWebhook(token, repo.full_name, hook.id).catch(() => undefined);
    webhookNote = `webhook ${hook.created ? 'created' : 'updated'} (id ${hook.id})`;
  } catch (err) {
    webhookNote = 'webhook NOT registered';
    console.warn(`\nCould not register the webhook (${explain(err, opts.repo).message}).`);
    console.warn(
      'Add it yourself: repository > Settings > Webhooks > Add webhook\n' +
        `  Payload URL:  ${stack.webhookUrl}\n` +
        '  Content type: application/json\n' +
        `  Secret:       ${webhookSecret}\n` +
        '  Events:       Just the push event\n' +
        'A token with "Webhooks: read and write" (fine-grained) or admin:repo_hook (classic) lets the CLI do this for you.',
    );
  }

  const host = opts.host?.toLowerCase();
  await updateManifest(out.bucket, opts.project, (m) => {
    m.source = {
      type: 'github',
      repo: repo.full_name,
      branch,
      host,
      installCommand: opts.installCommand,
      buildCommand: opts.buildCommand,
    };
  });

  console.log(`\nConnected ${opts.project} to ${repo.full_name} (${branch}): ${webhookNote}.`);
  console.log(`Every push to ${branch} now builds and deploys to ${host ?? out.domain}.`);
  console.log(`Deploy the current head now with: deployer github deploy -p ${opts.project}`);
}

export async function githubDeploy(opts: { project: string; detach?: boolean }, global: GlobalOptions): Promise<void> {
  assertProjectName(opts.project);
  const out = await getOutputs(global.stackName);
  const stack = githubStack(out);
  const { source } = await readManifest(out.bucket, opts.project);
  if (source?.type !== 'github') {
    throw new Error(`"${opts.project}" is not connected to GitHub. Run: deployer github connect -p ${opts.project} --repo owner/name`);
  }

  const token = await getSecret(stack.githubTokenSecretArn);
  let sha: string;
  try {
    sha = await headSha(token, source.repo, source.branch);
  } catch (err) {
    throw explain(err, source.repo);
  }
  console.log(`Building ${source.repo}@${sha.slice(0, 7)} (${source.branch})`);

  const buildId = await startBuild(stack.buildProject, {
    project: opts.project,
    id: newDeploymentId(),
    host: source.host,
    keep: DEFAULT_KEEP,
    source: { type: 'github', repo: source.repo, sha },
    installCommand: source.installCommand,
    buildCommand: source.buildCommand,
  });
  await watchBuild(buildId, source.host ?? out.domain, opts.project, Boolean(opts.detach));
}

export async function disconnect(opts: { project: string }, global: GlobalOptions): Promise<void> {
  assertProjectName(opts.project);
  const out = await getOutputs(global.stackName);
  const stack = githubStack(out);
  const { source } = await readManifest(out.bucket, opts.project);
  if (!source) throw new Error(`"${opts.project}" is not connected to GitHub.`);

  // One webhook serves every project on the same repository, so only remove it with the last one.
  let sharedWith = 0;
  for (const name of await listManifestProjects(out.bucket)) {
    if (name === opts.project) continue;
    if ((await readManifest(out.bucket, name)).source?.repo.toLowerCase() === source.repo.toLowerCase()) sharedWith++;
  }

  if (sharedWith > 0) {
    console.log(`Webhook kept: ${sharedWith} other project(s) deploy from ${source.repo}.`);
  } else {
    try {
      const removed = await removeWebhook(await getSecret(stack.githubTokenSecretArn), source.repo, stack.webhookUrl);
      console.log(removed ? `Removed the webhook from ${source.repo}.` : `No webhook found on ${source.repo}.`);
    } catch (err) {
      console.warn(`Could not remove the webhook (${explain(err, source.repo).message}); delete it in the repository settings.`);
    }
  }

  await updateManifest(out.bucket, opts.project, (m) => {
    delete m.source;
  });
  console.log(`Disconnected ${opts.project}. Its deployments are unchanged.`);
}
