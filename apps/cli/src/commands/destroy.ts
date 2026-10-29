import {
  DeleteStackCommand,
  waitUntilStackDeleteComplete,
} from '@aws-sdk/client-cloudformation';
import { emptyBucket } from '@deployer/core';
import { cloudFormation, findStack, GlobalOptions, readOutputs } from '../lib/aws.js';
import { confirmByTyping } from '../lib/prompt.js';

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

  const { bucket } = readOutputs(stack);
  console.log(`Emptying ${bucket}...`);
  await emptyBucket(bucket);

  console.log('Deleting stack (CloudFront takes a few minutes)...');
  const cfn = cloudFormation();
  await cfn.send(new DeleteStackCommand({ StackName: global.stackName }));
  await waitUntilStackDeleteComplete({ client: cfn, maxWaitTime: 1800 }, { StackName: global.stackName });
  console.log('Destroyed.');
}
