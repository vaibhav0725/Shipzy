import { ui } from '../lib/ui.js';
import * as path from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { DEFAULT_KEEP, newDeploymentId, readManifest, resolveTargetHosts, s3, startBuild } from '@shipzy/core';
import { getOutputs, GlobalOptions } from '../lib/aws.js';
import { projectBuildEnv } from '../lib/build-env.js';
import { detectFramework } from '../lib/build.js';
import { formatBytes } from '../lib/format.js';
import { parseKeep, resolveProject } from '../lib/project.js';
import { ensureProjectSite } from '../lib/sites.js';
import { zipSource } from '../lib/source-zip.js';
import { watchBuild } from '../lib/watch.js';
import type { DeployOptions } from './deploy.js';

/** Builds in CodeBuild in the user's account instead of on this machine. */
export async function remoteDeploy(dirArg: string, opts: DeployOptions, global: GlobalOptions): Promise<void> {
  if (opts.skipBuild) throw new Error('--skip-build only applies to local deploys (drop --remote).');
  const dir = path.resolve(dirArg);
  const project = resolveProject(dir, opts.project);
  detectFramework(dir); // fail in seconds on an unsupported project, not after a build has been queued
  const keep = parseKeep(opts.keep, DEFAULT_KEEP);

  const out = await getOutputs(global.stackName);
  if (!out.buildProject || !out.buildsBucket) {
    throw new Error('This stack has no build support yet. Run `shipzy init` to add it.');
  }
  const explicit = opts.host ? [opts.host.toLowerCase()] : undefined;
  await ensureProjectSite(out, global, project, explicit);
  const hosts = await resolveTargetHosts(out, project, await readManifest(out.bucket, project), out.domain, explicit);

  const env = await projectBuildEnv(out.bucket, global.stackName, project);
  const { zip, files, skippedEnvFiles } = zipSource(dir);
  if (skippedEnvFiles.length > 0) {
    console.log(
      `Not uploading ${skippedEnvFiles.join(', ')}. Remote builds use the variables stored with \`shipzy env\` ` +
        `(${env.length} set for this project); import a file with: shipzy env import -p ${project} <file>`,
    );
  }

  const id = newDeploymentId();
  const key = `src/${project}/${id}.zip`;
  console.log(ui.step(`Uploading source (${files} files, ${formatBytes(zip.length)})...`));
  await s3().send(new PutObjectCommand({ Bucket: out.buildsBucket, Key: key, Body: zip, ContentType: 'application/zip' }));

  const buildId = await startBuild(out.buildProject, {
    project,
    id,
    hosts: explicit,
    keep,
    source: { type: 's3', key },
    installCommand: opts.installCommand,
    buildCommand: opts.buildCommand,
    env,
  });
  await watchBuild(buildId, hosts, project, Boolean(opts.detach));
}
