import * as path from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { DEFAULT_KEEP, newDeploymentId, s3, startBuild } from '@deployer/core';
import { getOutputs, GlobalOptions } from '../lib/aws.js';
import { detectFramework } from '../lib/build.js';
import { describeFailure, duration, streamLogs } from '../lib/builds.js';
import { formatBytes } from '../lib/format.js';
import { parseKeep, resolveProject } from '../lib/project.js';
import { zipSource } from '../lib/source-zip.js';
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
    throw new Error('This stack has no build support yet. Run `deployer init` to add it.');
  }
  const host = (opts.host ?? out.domain).toLowerCase();

  const { zip, files, skippedEnvFiles } = zipSource(dir);
  if (skippedEnvFiles.length > 0) {
    console.log(
      `Not uploading ${skippedEnvFiles.join(', ')}. Build-time environment variables are not supported in remote builds yet.`,
    );
  }

  const id = newDeploymentId();
  const key = `src/${project}/${id}.zip`;
  console.log(`Uploading source (${files} files, ${formatBytes(zip.length)})...`);
  await s3().send(new PutObjectCommand({ Bucket: out.buildsBucket, Key: key, Body: zip, ContentType: 'application/zip' }));

  const buildId = await startBuild(out.buildProject, {
    project,
    id,
    host: opts.host ? host : undefined,
    keep,
    source: { type: 's3', key },
    installCommand: opts.installCommand,
    buildCommand: opts.buildCommand,
  });
  const short = buildId.split(':').pop()!.slice(0, 8);
  console.log(`Started build ${short} for ${project} (${id})\n`);

  if (opts.detach) {
    console.log(`Follow it:  deployer logs ${short} -f\nAll builds: deployer builds -p ${project}`);
    return;
  }

  // Ctrl-C stops watching, not the build.
  process.once('SIGINT', () => {
    console.log(`\nStopped watching. The build keeps running; follow it with: deployer logs ${short} -f`);
    process.exit(130);
  });
  const finished = await streamLogs(buildId, true);
  if (finished.buildStatus !== 'SUCCEEDED') throw new Error(describeFailure(finished));

  console.log(`\nLive: https://${host}  (build took ${duration(finished)})`);
  console.log('(Routing changes propagate to the edge in roughly 30 seconds.)');
}
