import {
  assertProjectName,
  deleteManifest,
  deletePrefix,
  deleteRoute,
  envParamPrefix,
  listDeploymentIds,
  listGithubConnections,
  listManifestProjects,
  listRoutes,
  readManifest,
  readPreviewBases,
  isPreviewHost,
} from '@deployer/core';
import { getOutputs, GlobalOptions } from '../lib/aws.js';
import { confirmByTyping } from '../lib/prompt.js';
import { removeDomain } from '../lib/domains.js';
import { deleteParamsUnder } from '../lib/ssm.js';
import { removeRepoWebhook } from '../lib/webhooks.js';

export interface DeleteOptions {
  project: string;
  yes?: boolean;
  dryRun?: boolean;
}

export async function deleteProject(opts: DeleteOptions, global: GlobalOptions): Promise<void> {
  const { project } = opts;
  assertProjectName(project);
  const out = await getOutputs(global.stackName);

  const [manifest, folders, allRoutes, known, bases] = await Promise.all([
    readManifest(out.bucket, project),
    listDeploymentIds(out.bucket, project),
    listRoutes(out.kvsArn),
    listManifestProjects(out.bucket),
    readPreviewBases(out.bucket),
  ]);
  const routes = allRoutes.filter((r) => r.target.startsWith(`${project}/`));

  // A project connected to GitHub but never deployed has only a history file.
  if (!known.includes(project) && manifest.deployments.length === 0 && folders.length === 0 && routes.length === 0) {
    throw new Error(`Project "${project}" not found. See \`deployer list\`.`);
  }

  console.log(`Project "${project}": ${folders.length} deployment folder${folders.length === 1 ? '' : 's'} in S3.`);
  for (const r of routes) {
    console.log(isPreviewHost(r.host, bases) ? `  pull request preview ${r.host}: will be removed` : `  live on ${r.host}: this site will start returning 404`);
  }
  if (routes.length === 0) console.log('  not live anywhere, so no site is affected');
  const envCount = (manifest.env?.production.length ?? 0) + (manifest.env?.preview.length ?? 0);
  if (envCount > 0) console.log(`  ${envCount} environment variable${envCount === 1 ? '' : 's'} will be deleted`);
  for (const d of manifest.domains ?? []) console.log(`  custom domain ${d}: its distribution, certificate and DNS records made by this tool will be removed`);
  if (manifest.source) console.log(`  deploys from ${manifest.source.repo}@${manifest.source.branch}: its GitHub connection will be removed`);

  if (opts.dryRun) {
    console.log('\nDry run: nothing was deleted.');
    return;
  }
  if (!opts.yes && !(await confirmByTyping(`\nThis permanently deletes "${project}" and all its deployments.`, project))) {
    console.log('Aborted.');
    return;
  }

  // Custom domains first: their distributions would otherwise be left pointing at a deleted project.
  for (const d of manifest.domains ?? []) for (const line of await removeDomain(out, global, d)) console.log(line);

  // Routes first so nothing serves a half-deleted project; history last so an interrupted run can be repeated.
  for (const r of routes) await deleteRoute(out.kvsArn, r.host);
  const objects = await deletePrefix(out.bucket, `${project}/`);
  if (out.buildsBucket) await deletePrefix(out.buildsBucket, `src/${project}/`);
  await deleteParamsUnder(envParamPrefix(global.stackName, project));

  // The history file holds the GitHub connection, so deal with the webhook before it goes.
  if (manifest.source) {
    const sharedWith = (await listGithubConnections(out.bucket)).filter(
      (c) => c.project !== project && c.source.repo.toLowerCase() === manifest.source!.repo.toLowerCase(),
    ).length;
    console.log(
      sharedWith > 0
        ? `Webhook kept: ${sharedWith} other project(s) deploy from ${manifest.source.repo}.`
        : await removeRepoWebhook(out, manifest.source.repo),
    );
  }
  await deleteManifest(out.bucket, project);
  console.log(`Deleted "${project}" (${objects} files, ${routes.length} route${routes.length === 1 ? '' : 's'}).`);
}
