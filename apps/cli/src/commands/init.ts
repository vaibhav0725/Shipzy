import { spinner, ui, uiErr } from '../lib/ui.js';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import {
  type Parameter,
  type Stack,
  CreateStackCommand,
  DeleteStackCommand,
  UpdateStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackDeleteComplete,
  waitUntilStackUpdateComplete,
} from '@aws-sdk/client-cloudformation';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '@shipzy/core';
import { assetPath as asset } from '../lib/assets.js';
import { paramsOf, waitOrExplain } from '../lib/cfn.js';
import { ask } from '../lib/prompt.js';
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

export interface InitOptions {
  /** monthly spending alert in USD, or "off" */
  budget?: string;
  budgetEmail?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Budget {
  limit: number;
  email: string;
}

/** What the person asked for, or undefined to leave the stack's alert as it is. */
async function wantedBudget(opts: InitOptions, existing: Stack | undefined): Promise<Budget | undefined> {
  const keptEmail = existing ? paramsOf(existing)['BudgetEmail'] : undefined;
  let raw = opts.budget?.trim();
  if (raw === undefined && !existing && process.stdin.isTTY) {
    // The first time only; after that the flags change it.
    console.log(`\n${ui.bold('Spending alert')} ${ui.dim('(optional)')}`);
    console.log(ui.dim('AWS has no spending cap, but it can email you when the month is heading past an amount you choose.'));
    raw = await ask(`Monthly amount in USD, or Enter to skip: $`);
    if (raw === '') return undefined;
  }
  if (raw === undefined) return undefined;
  if (/^(off|none|0)$/i.test(raw)) return { limit: 0, email: keptEmail ?? '' };
  const limit = Number(raw.replace(/^\$/, ''));
  if (!Number.isFinite(limit) || limit <= 0 || limit > 1_000_000) throw new Error(`"${raw}" is not an amount in USD (for example: --budget 25).`);
  let email = opts.budgetEmail?.trim() || keptEmail || '';
  if (!email && process.stdin.isTTY) email = await ask('Email for the alert: ');
  if (!EMAIL.test(email)) throw new Error('A spending alert needs an email address: --budget-email you@example.com');
  return { limit, email };
}

export async function init(global: GlobalOptions, flags: InitOptions = {}): Promise<void> {
  const opts = global;
  const me = await whoAmI();
  console.log(`${ui.dim('AWS account')} ${ui.name(me.account)} ${ui.dim(`(${me.arn})`)}`);
  if (me.arn.endsWith(':root')) {
    console.warn(`${uiErr.yellow(uiErr.bold('Warning:'))} you are using root credentials. Prefer an IAM user or SSO profile.`);
  }

  for (const name of ['template.json', 'engine.zip', 'build.sh', 'not-found.html']) {
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
  const budget = await wantedBudget(flags, stack);
  const changed = await applyStack(opts.stackName, templateBody, stack ? (engineKeyOf(stack) ?? '') : '', !stack, budget);
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

  // The page CloudFront falls back to for a path with no file (see the stack's error responses), kept at the root of
  // the sites bucket where no project folder can collide with it.
  const notFound = fs.readFileSync(asset('not-found.html'));
  const notFoundSha = createHash('sha256').update(notFound).digest('hex');
  const storedNotFound = await client.send(new HeadObjectCommand({ Bucket: out.bucket, Key: '404.html' })).catch(() => undefined);
  if (storedNotFound?.Metadata?.['sha256'] !== notFoundSha) {
    await client.send(
      new PutObjectCommand({
        Bucket: out.bucket,
        Key: '404.html',
        Body: notFound,
        ContentType: 'text/html; charset=utf-8',
        CacheControl: 'public, max-age=300',
        Metadata: { sha256: notFoundSha },
      }),
    );
  }

  // 3. Point the stack's Lambda functions at it.
  if (engineKeyOf(stack) !== engineKey) {
    console.log(ui.step('Installing the engine...'));
    await applyStack(opts.stackName, templateBody, engineKey, false, budget);
  } else if (!changed) {
    console.log(ui.ok('Already up to date.'));
  }

  await printSummary(opts.stackName);
}

/** Creates or updates the stack with the given engine key. Returns false when nothing needed changing. */
async function applyStack(stackName: string, templateBody: string, engineKey: string, create: boolean, budget?: Budget): Promise<boolean> {
  const cfn = cloudFormation();
  const parameters: Parameter[] = [{ ParameterKey: 'EngineKey', ParameterValue: engineKey }];
  if (budget) {
    parameters.push({ ParameterKey: 'BudgetLimit', ParameterValue: String(budget.limit) }, { ParameterKey: 'BudgetEmail', ParameterValue: budget.email });
  } else if (!create) {
    // Keep the alert as it is. A stack made before alerts existed has no such parameter to reuse, so it takes the default.
    const existing = await findStack(stackName);
    for (const key of ['BudgetLimit', 'BudgetEmail']) {
      if (existing?.Parameters?.some((p) => p.ParameterKey === key)) parameters.push({ ParameterKey: key, UsePreviousValue: true });
    }
  }
  const common = {
    StackName: stackName,
    TemplateBody: templateBody,
    Capabilities: ['CAPABILITY_IAM' as const],
    Parameters: parameters,
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
  const params = paramsOf(stack);
  const limit = Number(params['BudgetLimit'] ?? 0);
  console.log(
    `  ${ui.dim('Spend alert: ')} ${limit > 0 && params['BudgetEmail'] ? `$${limit} a month, emailed to ${params['BudgetEmail']}` : ui.dim('off (shipzy init --budget 25 --budget-email you@example.com)')}`,
  );
  console.log(`\n${ui.bold('Next:')} ${ui.accent('shipzy deploy <react-app-dir> --project <name>')}`);
}
