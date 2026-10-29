import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CloudFormationClient,
  CreateStackCommand,
  DescribeStackEventsCommand,
  UpdateStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackUpdateComplete,
} from '@aws-sdk/client-cloudformation';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '@deployer/core';
import {
  cloudFormation,
  engineKeyOf,
  errorMessage,
  findStack,
  GlobalOptions,
  readOutputs,
  whoAmI,
} from '../lib/aws.js';

const asset = (name: string) => fileURLToPath(new URL(`../../assets/${name}`, import.meta.url));
const MAX_WAIT_SECONDS = 1800;

export async function init(opts: GlobalOptions): Promise<void> {
  const me = await whoAmI();
  console.log(`AWS account ${me.account} (${me.arn})`);
  if (me.arn.endsWith(':root')) {
    console.warn('Warning: you are using root credentials. Prefer an IAM user or SSO profile.');
  }

  for (const name of ['template.json', 'engine.zip']) {
    if (!fs.existsSync(asset(name))) throw new Error(`${name} is missing; run \`npm run build\` at the repo root.`);
  }
  const templateBody = fs.readFileSync(asset('template.json'), 'utf8');
  const engineZip = fs.readFileSync(asset('engine.zip'));
  const engineKey = `engine/${createHash('sha256').update(engineZip).digest('hex').slice(0, 16)}.zip`;

  console.log(
    'This stack creates three IAM roles (build, engine, webhook). Each is limited to this stack\'s own\n' +
      'buckets, routing table, build project and secrets.',
  );

  // 1. Create or update the stack, leaving the engine as it is (the Builds bucket may not exist yet).
  let stack = await findStack(opts.stackName);
  const changed = await applyStack(opts.stackName, templateBody, stack ? (engineKeyOf(stack) ?? '') : '', !stack);
  stack = (await findStack(opts.stackName))!;
  const out = readOutputs(stack);
  if (!out.buildsBucket) throw new Error('Stack has no Builds bucket after the update; this is a bug.');

  // 2. Upload the engine code, named by content hash so unchanged code is never re-uploaded.
  const client = s3();
  const exists = await client
    .send(new HeadObjectCommand({ Bucket: out.buildsBucket, Key: engineKey }))
    .then(() => true, () => false);
  if (!exists) {
    console.log(`Uploading engine code (${(engineZip.length / 1048576).toFixed(1)} MB)...`);
    await client.send(new PutObjectCommand({ Bucket: out.buildsBucket, Key: engineKey, Body: engineZip }));
  }

  // 3. Point the stack's Lambda functions at it.
  if (engineKeyOf(stack) !== engineKey) {
    console.log('Installing the engine...');
    await applyStack(opts.stackName, templateBody, engineKey, false);
  } else if (!changed) {
    console.log('Already up to date.');
  }

  await printSummary(opts.stackName);
}

/** Creates or updates the stack with the given engine key. Returns false when nothing needed changing. */
async function applyStack(stackName: string, templateBody: string, engineKey: string, create: boolean): Promise<boolean> {
  const cfn = cloudFormation();
  const common = {
    StackName: stackName,
    TemplateBody: templateBody,
    Capabilities: ['CAPABILITY_IAM' as const],
    Parameters: [{ ParameterKey: 'EngineKey', ParameterValue: engineKey }],
  };

  if (create) {
    console.log(`Creating stack "${stackName}" (CloudFront takes ~5 minutes)...`);
    await cfn.send(new CreateStackCommand(common));
    await waitOrExplain(cfn, stackName, () =>
      waitUntilStackCreateComplete({ client: cfn, maxWaitTime: MAX_WAIT_SECONDS }, { StackName: stackName }),
    );
    return true;
  }

  try {
    await cfn.send(new UpdateStackCommand(common));
  } catch (err) {
    if (errorMessage(err).includes('No updates are to be performed')) return false;
    throw err;
  }
  console.log(`Updating stack "${stackName}"...`);
  await waitOrExplain(cfn, stackName, () =>
    waitUntilStackUpdateComplete({ client: cfn, maxWaitTime: MAX_WAIT_SECONDS }, { StackName: stackName }),
  );
  return true;
}

async function printSummary(stackName: string): Promise<void> {
  const stack = await findStack(stackName);
  if (!stack) throw new Error('Stack disappeared unexpectedly.');
  const out = readOutputs(stack);
  console.log('\nReady.');
  console.log(`  Bucket:       ${out.bucket}`);
  console.log(`  Distribution: ${out.distributionId}`);
  console.log(`  Default URL:  https://${out.domain}`);
  console.log(`  Builds:       ${out.buildProject}`);
  console.log(`  Webhook URL:  ${out.webhookUrl}`);
  console.log('\nNext: deployer deploy <react-app-dir> --project <name>');
}

async function waitOrExplain(cfn: CloudFormationClient, stackName: string, wait: () => Promise<unknown>): Promise<void> {
  try {
    await wait();
  } catch (err) {
    const events = await cfn
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
