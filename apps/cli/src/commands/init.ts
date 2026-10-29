import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CreateStackCommand,
  DescribeStackEventsCommand,
  UpdateStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackUpdateComplete,
} from '@aws-sdk/client-cloudformation';
import {
  cloudFormation,
  errorMessage,
  findStack,
  GlobalOptions,
  readOutputs,
  whoAmI,
} from '../lib/aws.js';

const TEMPLATE_URL = new URL('../../assets/template.json', import.meta.url);

export async function init(opts: GlobalOptions): Promise<void> {
  const me = await whoAmI();
  console.log(`AWS account ${me.account} (${me.arn})`);
  if (me.arn.endsWith(':root')) {
    console.warn('Warning: you are using root credentials. Prefer an IAM user or SSO profile.');
  }

  const templatePath = fileURLToPath(TEMPLATE_URL);
  if (!fs.existsSync(templatePath)) {
    throw new Error('Stack template missing; run `npm run build` at the repo root.');
  }
  const templateBody = fs.readFileSync(templatePath, 'utf8');

  const cfn = cloudFormation();
  const existing = await findStack(opts.stackName);
  const maxWaitTime = 1800;

  if (!existing) {
    console.log(`Creating stack "${opts.stackName}" (CloudFront takes ~5 minutes)...`);
    await cfn.send(new CreateStackCommand({ StackName: opts.stackName, TemplateBody: templateBody }));
    await waitOrExplain(opts.stackName, () =>
      waitUntilStackCreateComplete({ client: cfn, maxWaitTime }, { StackName: opts.stackName }),
    );
  } else {
    console.log(`Updating stack "${opts.stackName}"...`);
    try {
      await cfn.send(new UpdateStackCommand({ StackName: opts.stackName, TemplateBody: templateBody }));
    } catch (err) {
      if (errorMessage(err).includes('No updates are to be performed')) {
        console.log('Stack is already up to date.');
        return printOutputs(opts.stackName);
      }
      throw err;
    }
    await waitOrExplain(opts.stackName, () =>
      waitUntilStackUpdateComplete({ client: cfn, maxWaitTime }, { StackName: opts.stackName }),
    );
  }
  await printOutputs(opts.stackName);
}

async function printOutputs(stackName: string): Promise<void> {
  const stack = await findStack(stackName);
  if (!stack) throw new Error('Stack disappeared unexpectedly.');
  const out = readOutputs(stack);
  console.log('\nReady.');
  console.log(`  Bucket:       ${out.bucket}`);
  console.log(`  Distribution: ${out.distributionId}`);
  console.log(`  Default URL:  https://${out.domain}`);
  console.log('\nNext: deployer deploy <react-app-dir> --project <name>');
}

async function waitOrExplain(stackName: string, wait: () => Promise<unknown>): Promise<void> {
  try {
    await wait();
  } catch (err) {
    const events = await cloudFormation()
      .send(new DescribeStackEventsCommand({ StackName: stackName }))
      .catch(() => undefined);
    const failures = (events?.StackEvents ?? [])
      .filter((e) => e.ResourceStatus?.endsWith('FAILED') && e.ResourceStatusReason)
      .slice(0, 5)
      .map((e) => `  ${e.LogicalResourceId}: ${e.ResourceStatusReason}`);
    throw new Error(
      `Stack operation failed (${errorMessage(err)}).` + (failures.length ? `\n${failures.join('\n')}` : ''),
    );
  }
}
