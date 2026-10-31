import { ui } from '../lib/ui.js';
import {
  assertProjectName,
  DEFAULT_KEEP,
  explainGithubError,
  getRepo,
  GithubError,
  headSha,
  newDeploymentId,
  parseRepoInput,
  readManifest,
  resolveTargetHosts,
  startBuild,
} from '@shipzy/core';
import { getOutputs, GlobalOptions } from '../lib/aws.js';
import { projectBuildEnv } from '../lib/build-env.js';
import { parseKeep } from '../lib/project.js';
import { getSecret } from '../lib/secrets.js';
import { ensureProjectSite } from '../lib/sites.js';
import { watchBuild } from '../lib/watch.js';
import type { DeployOptions } from './deploy.js';

/** "owner/name" becomes a project name: lowercase letters, digits and dashes. */
const projectNameOf = (repo: string): string =>
  repo.split('/')[1]!.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

/**
 * Deploys a GitHub repository once, from a pasted address, building in the user's AWS account. A public repository
 * needs no token at all. A private one uses the token stored by `github connect`. Nothing is connected: pushes do not
 * redeploy (connect the project for that).
 */
export async function repoDeploy(input: string, opts: DeployOptions & { branch?: string }, global: GlobalOptions): Promise<void> {
  if (opts.skipBuild) throw new Error('--skip-build only applies to folder deploys.');
  const parsed = parseRepoInput(input);
  const project = opts.project ?? projectNameOf(parsed.repo);
  assertProjectName(project);
  const keep = parseKeep(opts.keep, DEFAULT_KEEP);

  const out = await getOutputs(global.stackName);
  if (!out.buildProject || !out.buildsBucket) throw new Error('This stack has no build support yet. Run `shipzy init` to add it.');

  // Public first: no token is needed, and none is sent. Only when GitHub says it cannot see the repository do we
  // try the stored token, which may belong to a private repository.
  let token: string | undefined;
  let repo;
  try {
    repo = await getRepo(undefined, parsed.repo);
  } catch (err) {
    if (!(err instanceof GithubError) || err.status !== 404) throw explainGithubError(err, parsed.repo);
    if (!out.githubTokenSecretArn) throw explainGithubError(err, parsed.repo);
    token = await getSecret(out.githubTokenSecretArn);
    try {
      repo = await getRepo(token, parsed.repo);
    } catch {
      throw new Error(
        `"${parsed.repo}" is private, or does not exist. For a private repository, store a token first:\n` +
          `  shipzy github connect -p ${project} --repo ${parsed.repo}`,
      );
    }
  }

  const branch = opts.branch ?? parsed.branch ?? repo.default_branch;
  let sha: string;
  try {
    sha = await headSha(token, repo.full_name, branch);
  } catch (err) {
    throw explainGithubError(err, `${repo.full_name}@${branch}`);
  }
  console.log(ui.step(`Building ${ui.name(repo.full_name)}@${sha.slice(0, 7)} (${branch}) as ${ui.name(`"${project}"`)}${repo.private ? '' : ' - public repository, no token used'}`));

  const explicit = opts.host ? [opts.host.toLowerCase()] : undefined;
  await ensureProjectSite(out, global, project, explicit);
  const manifest = await readManifest(out.bucket, project);
  const hosts = await resolveTargetHosts(out, project, manifest, out.domain, explicit);
  const buildId = await startBuild(out.buildProject, {
    project,
    id: newDeploymentId(),
    hosts: explicit,
    keep,
    source: { type: 'github', repo: repo.full_name, sha, public: !repo.private },
    installCommand: opts.installCommand,
    buildCommand: opts.buildCommand,
    env: await projectBuildEnv(out.bucket, global.stackName, project),
  });
  await watchBuild(buildId, hosts, project, Boolean(opts.detach));
  if (!manifest.source) {
    console.log(`\nThis was a one-time deploy. To redeploy on every push: shipzy github connect -p ${project} --repo ${repo.full_name}`);
  }
}
