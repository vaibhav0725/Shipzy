import { ui, uiErr } from '../lib/ui.js';
import { randomBytes } from 'node:crypto';
import {
  assertProjectName,
  DEFAULT_KEEP,
  explainGithubError,
  getRepo,
  headSha,
  listGithubConnections,
  newDeploymentId,
  pingWebhook,
  readManifest,
  readPreviewBases,
  REPO_RE,
  resolveTargetHosts,
  startBuild,
  updateManifest,
  upsertWebhook,
} from '@deployer/core';
import { getOutputs, GlobalOptions, StackOutputs } from '../lib/aws.js';
import { projectBuildEnv } from '../lib/build-env.js';
import { promptHidden } from '../lib/prompt.js';
import { getSecret, putSecret } from '../lib/secrets.js';
import { removeRepoWebhook } from '../lib/webhooks.js';
import { ensureProjectSite } from '../lib/sites.js';
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
  /** build a preview of every pull request that targets the branch */
  previews?: boolean;
}

/** The events GitHub should send: pushes always, pull requests when any project on the repository wants previews. */
async function webhookEvents(bucket: string, repo: string, alsoPreviews = false): Promise<string[]> {
  const wants =
    alsoPreviews ||
    (await listGithubConnections(bucket)).some((c) => c.source.previews && c.source.repo.toLowerCase() === repo.toLowerCase());
  return wants ? ['push', 'pull_request'] : ['push'];
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
    throw explainGithubError(err, opts.repo);
  }
  const branch = opts.branch ?? repo.default_branch;
  if (!opts.reuseToken) await putSecret(stack.githubTokenSecretArn, token);

  // The webhook secret is created by the stack; GitHub signs every delivery with it.
  const webhookSecret = await getSecret(stack.webhookSecretArn);
  let webhookNote: string;
  try {
    const events = await webhookEvents(out.bucket, repo.full_name, opts.previews);
    const hook = await upsertWebhook(token, repo.full_name, stack.webhookUrl, webhookSecret, events);
    await pingWebhook(token, repo.full_name, hook.id).catch(() => undefined);
    webhookNote = `webhook ${hook.created ? 'created' : 'updated'} (id ${hook.id})`;
  } catch (err) {
    webhookNote = 'webhook NOT registered';
    console.warn(uiErr.yellow(`\nCould not register the webhook (${explainGithubError(err, opts.repo).message}).`));
    console.warn(
      'Add it yourself: repository > Settings > Webhooks > Add webhook\n' +
        `  Payload URL:  ${stack.webhookUrl}\n` +
        '  Content type: application/json\n' +
        `  Secret:       aws secretsmanager get-secret-value --secret-id ${stack.webhookSecretArn} --query SecretString --output text\n` +
        `  Events:       ${opts.previews ? 'Pushes and Pull requests' : 'Just the push event'}\n` +
        'A token with "Webhooks: read and write" (fine-grained) or admin:repo_hook (classic) lets the CLI do this for you:\n' +
        '  fix the token\'s permissions, then run `deployer github rotate-secret`.',
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
      previews: opts.previews || undefined,
    };
  });

  // Without a host or domain the project is served at an address of its own; create it now so pushes have somewhere to go.
  const siteHost = await ensureProjectSite(out, global, opts.project, host ? [host] : undefined);

  console.log(`\n${ui.ok(`Connected ${ui.name(opts.project)} to ${ui.name(repo.full_name)} (${branch}): ${webhookNote}.`)}`);
  console.log(`Every push to ${branch} now builds and deploys to ${ui.url(host ?? siteHost ?? out.domain)}.`);
  if (opts.previews) {
    console.log(`Every pull request into ${branch} now gets its own preview URL, removed when the pull request closes.`);
    console.log('The GitHub token needs "Pull requests: Read and write" for the preview comment (fine-grained token) or the repo scope (classic).');
    if ((await readPreviewBases(out.bucket)).length === 0) {
      console.warn('\nNo preview domain is set up yet, so no preview can be served. Add one with:\n  deployer domain add "*.preview.<your domain>" --preview');
    }
  }
  console.log(`${ui.dim('Deploy the current head now with:')} ${ui.accent(`deployer github deploy -p ${opts.project}`)}`);
}

export async function githubDeploy(opts: { project: string; detach?: boolean }, global: GlobalOptions): Promise<void> {
  assertProjectName(opts.project);
  const out = await getOutputs(global.stackName);
  const stack = githubStack(out);
  const manifest = await readManifest(out.bucket, opts.project);
  const { source } = manifest;
  if (source?.type !== 'github') {
    throw new Error(`"${opts.project}" is not connected to GitHub. Run: deployer github connect -p ${opts.project} --repo owner/name`);
  }

  const explicit = source.host ? [source.host] : undefined;
  await ensureProjectSite(out, global, opts.project, explicit);
  const token = await getSecret(stack.githubTokenSecretArn);
  let sha: string;
  try {
    sha = await headSha(token, source.repo, source.branch);
  } catch (err) {
    throw explainGithubError(err, source.repo);
  }
  console.log(ui.step(`Building ${ui.name(source.repo)}@${sha.slice(0, 7)} (${source.branch})`));

  const buildId = await startBuild(stack.buildProject, {
    project: opts.project,
    id: newDeploymentId(),
    hosts: explicit,
    keep: DEFAULT_KEEP,
    source: { type: 'github', repo: source.repo, sha },
    installCommand: source.installCommand,
    buildCommand: source.buildCommand,
    env: await projectBuildEnv(out.bucket, global.stackName, opts.project),
  });
  const hosts = await resolveTargetHosts(out, opts.project, await readManifest(out.bucket, opts.project), out.domain, explicit);
  await watchBuild(buildId, hosts, opts.project, Boolean(opts.detach));
}

export async function disconnect(opts: { project: string }, global: GlobalOptions): Promise<void> {
  assertProjectName(opts.project);
  const out = await getOutputs(global.stackName);
  const stack = githubStack(out);
  const { source } = await readManifest(out.bucket, opts.project);
  if (!source) throw new Error(`"${opts.project}" is not connected to GitHub.`);

  // One webhook serves every project on the same repository, so only remove it with the last one.
  const sharedWith = (await listGithubConnections(out.bucket)).filter(
    (c) => c.project !== opts.project && c.source.repo.toLowerCase() === source.repo.toLowerCase(),
  ).length;
  console.log(sharedWith > 0 ? `Webhook kept: ${sharedWith} other project(s) deploy from ${source.repo}.` : await removeRepoWebhook(out, source.repo));

  await updateManifest(out.bucket, opts.project, (m) => {
    delete m.source;
  });
  console.log(ui.ok(`Disconnected ${ui.name(opts.project)}. Its deployments are unchanged.`));
}

/** Replaces the webhook secret and re-registers the webhook on every connected repository. */
export async function rotateSecret(global: GlobalOptions): Promise<void> {
  const out = await getOutputs(global.stackName);
  const stack = githubStack(out);

  const repos = new Set((await listGithubConnections(out.bucket)).map((c) => c.source.repo));

  const secret = randomBytes(30).toString('base64url');
  await putSecret(stack.webhookSecretArn, secret);
  console.log(ui.ok('Stored a new webhook secret.'));
  if (repos.size === 0) {
    console.log('No project is connected to GitHub, so there is no webhook to update.');
    return;
  }

  const token = await getSecret(stack.githubTokenSecretArn);
  let failed = 0;
  for (const repo of repos) {
    try {
      const hook = await upsertWebhook(token, repo, stack.webhookUrl, secret, await webhookEvents(out.bucket, repo));
      console.log(`  ${repo}: webhook ${hook.created ? 'created' : 'updated'}`);
    } catch (err) {
      failed++;
      console.warn(`  ${repo}: could not update the webhook (${explainGithubError(err, repo).message})`);
    }
  }
  if (failed > 0) {
    console.warn(
      '\nFor those, set the new secret by hand in the repository webhook settings. Read it with:\n' +
        `  aws secretsmanager get-secret-value --secret-id ${stack.webhookSecretArn} --query SecretString --output text`,
    );
  }
  console.log('\nThe webhook picks up the new secret within 5 minutes; deliveries signed with the old one are rejected.');
}
