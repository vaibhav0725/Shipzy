import { ui } from './ui.js';
import * as fs from 'node:fs';
import { ListStacksCommand } from '@aws-sdk/client-cloudformation';
import { assertProjectName, needsOwnSite, readManifest, updateManifest } from '@deployer/core';
import { assetPath } from './assets.js';
import { cloudFormation, findStack, GlobalOptions, StackOutputs } from './aws.js';
import { deployStack, outputsOf, paramsOf, removeStack } from './cfn.js';

export const siteStackPrefix = (stackName: string) => `${stackName}-site-`;
export const siteStackName = (stackName: string, project: string) => `${siteStackPrefix(stackName)}${project}`;

/**
 * Gives a project its own CloudFront address if it needs one: the first deploy of a project that has no custom
 * domain and no address yet creates a small distribution for it (about 5 minutes, once) and records the address.
 * Returns the address when one was created or already exists, otherwise undefined.
 *
 * Safe to repeat: a stack that already exists is left alone and the address is simply recorded again.
 */
export async function ensureProjectSite(out: StackOutputs, global: GlobalOptions, project: string, explicit?: string[]): Promise<string | undefined> {
  assertProjectName(project);
  const manifest = await readManifest(out.bucket, project);
  if (manifest.siteHost) return manifest.siteHost;
  if (!(await needsOwnSite(out, project, manifest, out.domain, explicit))) return undefined;
  if (!out.originDomain || !out.oacId || !out.routerFunctionArn) {
    throw new Error('This stack predates project addresses. Run `deployer init` to update it.');
  }

  console.log(ui.step(`Creating an address of its own for ${ui.name(project)} (CloudFront, about 5 minutes; only the first deploy of a project)...`));
  const { outputs } = await deployStack({
    name: siteStackName(global.stackName, project),
    templateBody: fs.readFileSync(assetPath('site-template.json'), 'utf8'),
    parameters: {
      ProjectName: project,
      OriginDomainName: out.originDomain,
      OacId: out.oacId,
      RouterFunctionArn: out.routerFunctionArn,
    },
    tags: { 'deployer:stack': global.stackName, 'deployer:project': project },
  });
  const siteHost = outputs['DistributionDomain']!.toLowerCase();
  await updateManifest(out.bucket, project, (m) => {
    m.siteHost = siteHost;
  });
  console.log(ui.ok(`${ui.name(project)} will be served at ${ui.url(`https://${siteHost}`)}`));
  return siteHost;
}

export interface SiteStackInfo {
  stackName: string;
  project: string;
  distributionDomain?: string;
}

const LIVE_STATUSES = [
  'CREATE_IN_PROGRESS', 'CREATE_COMPLETE', 'UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE',
  'ROLLBACK_COMPLETE', 'CREATE_FAILED', 'DELETE_FAILED', 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS',
] as const;

export async function listSiteStacks(stackName: string): Promise<SiteStackInfo[]> {
  const prefix = siteStackPrefix(stackName);
  const names: string[] = [];
  let token: string | undefined;
  do {
    const page = await cloudFormation().send(new ListStacksCommand({ StackStatusFilter: [...LIVE_STATUSES], NextToken: token }));
    for (const s of page.StackSummaries ?? []) if (s.StackName?.startsWith(prefix)) names.push(s.StackName);
    token = page.NextToken;
  } while (token);
  const found = await Promise.all(names.map(async (name) => ({ name, stack: await findStack(name) })));
  return found.flatMap(({ name, stack }) =>
    stack
      ? [{ stackName: name, project: paramsOf(stack)['ProjectName'] ?? name.slice(prefix.length), distributionDomain: outputsOf(stack)['DistributionDomain'] }]
      : [],
  );
}

/** Deletes the project's own address (its distribution stack). The route must already be gone. */
export async function removeProjectSite(global: GlobalOptions, project: string): Promise<boolean> {
  const name = siteStackName(global.stackName, project);
  if (!(await findStack(name))) return false;
  await removeStack(name);
  return true;
}
