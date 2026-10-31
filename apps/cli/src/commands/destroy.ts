import { spinner, ui, uiErr } from '../lib/ui.js';
import {
  DeleteStackCommand,
  waitUntilStackDeleteComplete,
} from '@aws-sdk/client-cloudformation';
import { emptyBucket, envParamPrefix, listGithubConnections } from '@shipzy/core';
import { cloudFormation, errorMessage, findStack, GlobalOptions, readOutputs } from '../lib/aws.js';
import { confirmByTyping } from '../lib/prompt.js';
import { deleteParamsUnder } from '../lib/ssm.js';
import { listDomainStacks, removeDomain } from '../lib/domains.js';
import { listSiteStacks, removeProjectSite } from '../lib/sites.js';
import { removeRepoWebhook } from '../lib/webhooks.js';

export async function destroy(opts: { yes?: boolean }, global: GlobalOptions): Promise<void> {
  const stack = await findStack(global.stackName);
  if (!stack) {
    console.log(`Stack "${global.stackName}" does not exist.`);
    return;
  }

  if (
    !opts.yes &&
    !(await confirmByTyping(`This deletes ALL deployed sites and the stack "${global.stackName}".`, global.stackName))
  ) {
    console.log('Aborted.');
    return;
  }

  const out = readOutputs(stack);

  // Custom domains are separate stacks that read this stack's bucket; take them down first.
  // Each one is tried even if another fails. The stack itself is only deleted once none are left: a domain's
  // distribution uses this stack's router and access control, so deleting the stack first would fail.
  const failed: string[] = [];
  // Project addresses are the same kind of stack (a distribution in front of this stack's bucket and router).
  for (const s of await listSiteStacks(global.stackName)) {
    console.log(ui.step(`Removing the address of ${ui.name(s.project)}...`));
    try {
      await removeProjectSite(global, s.project);
    } catch (err) {
      failed.push(`the address of ${s.project}`);
      console.warn(uiErr.yellow(`  Could not remove it (${errorMessage(err)}).`));
    }
  }
  for (const d of await listDomainStacks(global.stackName)) {
    console.log(ui.step(`Removing domain ${ui.name(d.host)}...`));
    try {
      for (const line of await removeDomain(out, global, d.host)) console.log(`  ${line}`);
    } catch (err) {
      failed.push(d.host);
      console.warn(uiErr.yellow(`  Could not remove ${d.host} (${errorMessage(err)}).`));
    }
  }
  if (failed.length > 0) {
    throw new Error(
      `Stopped before deleting the stack: ${failed.join(', ')} could not be removed. ` +
        `Nothing else was deleted. Fix the cause, then run \`shipzy destroy\` again (for a domain, \`shipzy domain rm <host>\` also works).`,
    );
  }

  // Once the stack is gone its webhook URL is dead, so take the webhooks off the repositories first.
  try {
    const repos = new Set((await listGithubConnections(out.bucket)).map((c) => c.source.repo));
    for (const repo of repos) console.log(await removeRepoWebhook(out, repo));
  } catch (err) {
    console.warn(`Could not check for GitHub webhooks (${errorMessage(err)}); remove any by hand in your repositories.`);
  }

  try {
    const removed = await deleteParamsUnder(envParamPrefix(global.stackName));
    if (removed > 0) console.log(`Removed ${removed} environment variable${removed === 1 ? '' : 's'}.`);
  } catch (err) {
    console.warn(`Could not remove environment variables (${errorMessage(err)}); delete /deployer/${global.stackName}/ in Parameter Store by hand.`);
  }

  // CloudFormation cannot delete a bucket that still has objects in it.
  for (const bucket of [out.bucket, out.buildsBucket]) {
    if (!bucket) continue;
    console.log(ui.step(`Emptying ${bucket}...`));
    // Resuming a destroy that stopped part-way: the bucket may already be deleted.
    await emptyBucket(bucket).catch((err) => {
      if ((err as { name?: string }).name !== 'NoSuchBucket') throw err;
    });
  }

  console.log(ui.step('Deleting stack (CloudFront takes a few minutes)...'));
  const cfn = cloudFormation();
  await cfn.send(new DeleteStackCommand({ StackName: global.stackName }));
  const stop = spinner(`Deleting ${global.stackName}`);
  try {
    await waitUntilStackDeleteComplete({ client: cfn, maxWaitTime: 1800 }, { StackName: global.stackName });
  } finally {
    stop();
  }
  console.log(ui.ok(ui.bold(ui.green('Destroyed.'))));
}
