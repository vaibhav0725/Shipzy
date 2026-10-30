import { spinner, ui, uiErr } from '../lib/ui.js';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  UpdateStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackDeleteComplete,
  waitUntilStackUpdateComplete,
} from '@aws-sdk/client-cloudformation';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '@deployer/core';
import { assetPath as asset } from '../lib/assets.js';
import { waitOrExplain } from '../lib/cfn.js';
import {
  cloudFormation,
  engineKeyOf,
  errorMessage,
  findStack,
  GlobalOptions,
  readOutputs,
  whoAmI,
} from '../lib/aws.js';

const MAX_WAIT_SECONDS = 1800;
const BUILD_SCRIPT_KEY = 'scripts/build.sh';

export async function init(opts: GlobalOptions): Promise<void> {
  const me = await whoAmI();
  console.log(`${ui.dim('AWS account')} ${ui.name(me.account)} ${ui.dim(`(${me.arn})`)}`);
  if (me.arn.endsWith(':root')) {
    console.warn(`${uiErr.yellow(uiErr.bold('Warning:'))} you are using root credentials. Prefer an IAM user or SSO profile.`);
  }

  for (const name of ['template.json', 'engine.zip', 'build.sh']) {
    if (!fs.existsSync(asset(name))) throw new Error(`${name} is missing; run \`npm run build\` at the repo root.`);
  }
  const templateBody = fs.readFileSync(asset('template.json'), 'utf8');
  const engineZip = fs.readFileSync(asset('engine.zip'));
  const buildScript = fs.readFileSync(asset('build.sh'));
  const engineKey = `engine/${createHash('sha256').update(engineZip).digest('hex').slice(0, 16)}.zip`;

  console.log(
    'This stack creates three IAM roles (build, engine, webhook). Each is limited to this stack\'s own\n' +
      'buckets, routing table, build project and secrets.',
  );

  // 1. Create or update the stack, leaving the engine as it is (the Builds bucket may not exist yet).
  let stack = await findStack(opts.stackName);
  if (stack?.StackStatus === 'ROLLBACK_COMPLETE') {
    // A first attempt that failed and rolled back can only be deleted, not updated.
    console.log(`A previous attempt to create "${opts.stackName}" failed and was rolled back; removing it before retrying...`);
    const cfn = cloudFormation();
    await cfn.send(new DeleteStackCommand({ StackName: opts.stackName }));
    await waitUntilStackDeleteComplete({ client: cfn, maxWaitTime: MAX_WAIT_SECONDS }, { StackName: opts.stackName });
    stack = undefined;
  }
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
    console.log(ui.step(`Uploading engine code (${(engineZip.length / 1048576).toFixed(1)} MB)...`));
    await client.send(new PutObjectCommand({ Bucket: out.buildsBucket, Key: engineKey, Body: engineZip }));
  }

  // The build script has a fixed key (CodeBuild fetches it by name), so compare content to skip no-op uploads.
  const scriptSha = createHash('sha256').update(buildScript).digest('hex');
  const stored = await client
    .send(new HeadObjectCommand({ Bucket: out.buildsBucket, Key: BUILD_SCRIPT_KEY }))
    .catch(() => undefined);
  if (stored?.Metadata?.['sha256'] !== scriptSha) {
    console.log(ui.step('Updating the build script...'));
    await client.send(
      new PutObjectCommand({
        Bucket: out.buildsBucket,
        Key: BUILD_SCRIPT_KEY,
        Body: buildScript,
        ContentType: 'text/x-shellscript',
        Metadata: { sha256: scriptSha },
      }),
    );
  }

  // 3. Point the stack's Lambda functions at it.
  if (engineKeyOf(stack) !== engineKey) {
    console.log(ui.step('Installing the engine...'));
    await applyStack(opts.stackName, templateBody, engineKey, false);
  } else if (!changed) {
    console.log(ui.ok('Already up to date.'));
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
    console.log(ui.step(`Creating stack ${ui.name(`"${stackName}"`)} (CloudFront takes ~5 minutes)...`));
    await cfn.send(new CreateStackCommand(common));
    const stop = spinner(`Creating ${stackName}`);
    try {
      await waitOrExplain(cfn, stackName, () =>
        waitUntilStackCreateComplete({ client: cfn, maxWaitTime: MAX_WAIT_SECONDS }, { StackName: stackName }),
      );
    } finally {
      stop();
    }
    return true;
  }

  try {
    await cfn.send(new UpdateStackCommand(common));
  } catch (err) {
    if (errorMessage(err).includes('No updates are to be performed')) return false;
    throw err;
  }
  console.log(ui.step(`Updating stack ${ui.name(`"${stackName}"`)}...`));
  const stop = spinner(`Updating ${stackName}`);
  try {
    await waitOrExplain(cfn, stackName, () =>
      waitUntilStackUpdateComplete({ client: cfn, maxWaitTime: MAX_WAIT_SECONDS }, { StackName: stackName }),
    );
  } finally {
    stop();
  }
  return true;
}

async function printSummary(stackName: string): Promise<void> {
  const stack = await findStack(stackName);
  if (!stack) throw new Error('Stack disappeared unexpectedly.');
  const out = readOutputs(stack);
  console.log(`\n${ui.ok(ui.bold(ui.green('Ready.')))}`);
  console.log(`  ${ui.dim('Bucket:      ')} ${out.bucket}`);
  console.log(`  ${ui.dim('Distribution:')} ${out.distributionId}`);
  console.log(`  ${ui.dim('Default URL: ')} ${ui.url(`https://${out.domain}`)}`);
  console.log(`  ${ui.dim('Builds:      ')} ${out.buildProject}`);
  console.log(`  ${ui.dim('Webhook URL: ')} ${out.webhookUrl}`);
  console.log(`\n${ui.bold('Next:')} ${ui.accent('deployer deploy <react-app-dir> --project <name>')}`);
}
