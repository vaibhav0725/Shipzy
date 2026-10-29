import { getOutputs, GlobalOptions } from '../lib/aws.js';
import { deleteRoute, listRoutes } from '../lib/kvs.js';
import { assertProjectName, deleteManifest, readManifest } from '../lib/manifest.js';
import { confirmByTyping } from '../lib/prompt.js';
import { deletePrefix, listDeploymentIds } from '../lib/upload.js';

export interface DeleteOptions {
  project: string;
  yes?: boolean;
  dryRun?: boolean;
}

export async function deleteProject(opts: DeleteOptions, global: GlobalOptions): Promise<void> {
  const { project } = opts;
  assertProjectName(project);
  const out = await getOutputs(global.stackName);

  const [manifest, folders, allRoutes] = await Promise.all([
    readManifest(out.bucket, project),
    listDeploymentIds(out.bucket, project),
    listRoutes(out.kvsArn),
  ]);
  const routes = allRoutes.filter((r) => r.target.startsWith(`${project}/`));

  if (manifest.deployments.length === 0 && folders.length === 0 && routes.length === 0) {
    throw new Error(`Project "${project}" not found. See \`deployer list\`.`);
  }

  console.log(`Project "${project}": ${folders.length} deployment folder${folders.length === 1 ? '' : 's'} in S3.`);
  for (const r of routes) console.log(`  live on ${r.host}: this site will start returning 404`);
  if (routes.length === 0) console.log('  not live anywhere, so no site is affected');

  if (opts.dryRun) {
    console.log('\nDry run: nothing was deleted.');
    return;
  }
  if (!opts.yes && !(await confirmByTyping(`\nThis permanently deletes "${project}" and all its deployments.`, project))) {
    console.log('Aborted.');
    return;
  }

  // Routes first so nothing serves a half-deleted project; history last so an interrupted run can be repeated.
  for (const r of routes) await deleteRoute(out.kvsArn, r.host);
  const objects = await deletePrefix(out.bucket, `${project}/`);
  await deleteManifest(out.bucket, project);
  console.log(`Deleted "${project}" (${objects} files, ${routes.length} route${routes.length === 1 ? '' : 's'}).`);
}
