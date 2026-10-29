import {
  DeleteStackCommand,
  waitUntilStackDeleteComplete,
} from '@aws-sdk/client-cloudformation';
import { emptyBucket, envParamPrefix, listGithubConnections } from '@deployer/core';
import { cloudFormation, errorMessage, findStack, GlobalOptions, readOutputs } from '../lib/aws.js';
import { confirmByTyping } from '../lib/prompt.js';
import { deleteParamsUnder } from '../lib/ssm.js';
import { listDomainStacks, removeDomain } from '../lib/domains.js';
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
  try {
    for (const d of await listDomainStacks(global.stackName)) {
      console.log(`Removing domain ${d.host}...`);
      for (const line of await removeDomain(out, global, d.host)) console.log(`  ${line}`);
    }
  } catch (err) {
    console.warn(`Could not remove custom domains (${errorMessage(err)}); remove them with \`deployer domain rm <host>\` before destroying.`);
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
    console.log(`Emptying ${bucket}...`);
    await emptyBucket(bucket);
  }

  console.log('Deleting stack (CloudFront takes a few minutes)...');
  const cfn = cloudFormation();
  await cfn.send(new DeleteStackCommand({ StackName: global.stackName }));
  await waitUntilStackDeleteComplete({ client: cfn, maxWaitTime: 1800 }, { StackName: global.stackName });
  console.log('Destroyed.');
}
