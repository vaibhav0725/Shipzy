import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { HeadObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { zipSync } from 'fflate';
import { s3 } from '@shipzy/core';
import { assetPath } from '../lib/assets.js';
import { findStack, getOutputs, GlobalOptions } from '../lib/aws.js';
import { deployStack, outputsOf, paramsOf, removeStack } from '../lib/cfn.js';
import { ensureDashboard } from '../lib/dashboard-app.js';
import { ask, promptHidden } from '../lib/prompt.js';
import { getSecret, putSecret } from '../lib/secrets.js';
import { spinner, ui } from '../lib/ui.js';

// `shipzy dashboard --deploy`: runs the dashboard in your own AWS account, behind a GitHub sign-in that only the
// usernames you list can pass. Nothing runs on shipzy servers. See docs/DESIGN-NEXT.md.

export interface HostOptions {
  deploy?: boolean;
  configure?: boolean;
  remove?: boolean;
  /** comma-separated GitHub usernames */
  allow?: string;
}

const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export const dashboardStackName = (main: string) => `${main}-dashboard`;

function parseUsers(raw: string): string[] {
  const users = raw.split(',').map((u) => u.trim()).filter(Boolean);
  const bad = users.find((u) => !USERNAME.test(u) || u.endsWith('-'));
  if (bad) throw new Error(`"${bad}" is not a GitHub username.`);
  if (users.length === 0) throw new Error('Name at least one GitHub user: --allow your-github-username');
  return [...new Set(users)];
}

/** The folder that holds the dashboard server (apps/dashboard/server.js and its node_modules). */
function dashboardRoot(serverFile: string): string {
  return path.resolve(path.dirname(serverFile), '..', '..');
}

function walk(dir: string, base: string, into: Record<string, Uint8Array>, skip: (rel: string) => boolean): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.posix.join(base, entry.name);
    if (skip(rel)) continue;
    if (entry.isDirectory()) walk(full, rel, into, skip);
    else if (entry.isFile()) into[rel] = new Uint8Array(fs.readFileSync(full));
  }
}

/** The code the two functions run: the dashboard server, this CLI, and the two handlers. */
function buildPackage(serverFile: string): Buffer {
  const files: Record<string, Uint8Array> = {};
  walk(dashboardRoot(serverFile), 'app', files, (rel) => rel.includes('/.next/cache') || rel.endsWith('.map'));
  const assets = path.dirname(assetPath('template.json'));
  const cliFile = path.resolve(assets, '..', 'dist', 'shipzy.mjs');
  if (!fs.existsSync(cliFile)) throw new Error(`Cannot find the CLI bundle at ${cliFile}; run \`npm run build\` first.`);
  files['cli/shipzy.mjs'] = new Uint8Array(fs.readFileSync(cliFile));
  for (const name of fs.readdirSync(assets)) {
    if (name === 'dashboard' || name === 'hosted') continue;
    const full = path.join(assets, name);
    if (fs.statSync(full).isFile()) files[`cli/assets/${name}`] = new Uint8Array(fs.readFileSync(full));
  }
  for (const name of ['web.mjs', 'worker.mjs']) {
    const file = path.join(assets, 'hosted', name);
    if (!fs.existsSync(file)) throw new Error(`${name} is missing; run \`npm run build\` at the repo root.`);
    files[name] = new Uint8Array(fs.readFileSync(file));
  }
  return Buffer.from(zipSync(files, { level: 6 }));
}

export async function dashboardHost(opts: HostOptions, global: GlobalOptions): Promise<void> {
  if (opts.remove) return remove(global);
  if (opts.configure && !opts.deploy) return configure(global);
  return deploy(opts, global);
}

async function deploy(opts: HostOptions, global: GlobalOptions): Promise<void> {
  const out = await getOutputs(global.stackName);
  for (const [name, value] of Object.entries({ buildsBucket: out.buildsBucket, buildProject: out.buildProject, engineFunction: out.engineFunction, webhookSecretArn: out.webhookSecretArn, githubTokenSecretArn: out.githubTokenSecretArn })) {
    if (!value) throw new Error(`The stack has no ${name}; run \`shipzy init\` first.`);
  }
  const name = dashboardStackName(global.stackName);
  const existing = await findStack(name);

  let users = opts.allow ? parseUsers(opts.allow) : [];
  if (users.length === 0 && existing) users = parseUsers(paramsOf(existing)['AllowedUsers'] ?? '');
  if (users.length === 0 && process.stdin.isTTY) users = parseUsers(await ask('GitHub username(s) allowed to sign in (comma-separated): '));
  if (users.length === 0) throw new Error('Name who may sign in: --allow your-github-username');

  console.log(ui.step('Packaging the dashboard...'));
  const serverFile = await ensureDashboard(false);
  const stopZip = spinner('Compressing');
  let zip: Buffer;
  try {
    zip = buildPackage(serverFile);
  } finally {
    stopZip();
  }
  const key = `hosted/${createHash('sha256').update(zip).digest('hex').slice(0, 16)}.zip`;
  const client = s3();
  const there = await client.send(new HeadObjectCommand({ Bucket: out.buildsBucket!, Key: key })).then(() => true, () => false);
  if (!there) {
    console.log(ui.step(`Uploading the dashboard (${(zip.length / 1048576).toFixed(0)} MB)...`));
    await client.send(new PutObjectCommand({ Bucket: out.buildsBucket!, Key: key, Body: zip }));
  }

  const { outputs } = await deployStack({
    name,
    templateBody: fs.readFileSync(assetPath('dashboard-template.json'), 'utf8'),
    parameters: {
      MainStackName: global.stackName,
      CodeBucket: out.buildsBucket!,
      CodeKey: key,
      SitesBucket: out.bucket,
      BuildsBucket: out.buildsBucket!,
      KvsArn: out.kvsArn,
      BuildProject: out.buildProject!,
      EngineFunction: out.engineFunction!,
      WebhookSecretArn: out.webhookSecretArn!,
      GithubTokenSecretArn: out.githubTokenSecretArn!,
      AllowedUsers: users.join(','),
      PublicHost: existing ? (paramsOf(existing)['PublicHost'] ?? '') : '',
    },
    capabilities: ['CAPABILITY_NAMED_IAM'],
    label: existing ? 'Updating the dashboard' : 'Creating the dashboard',
  });

  const url = outputs['DashboardUrl']!.replace(/\/$/, '');
  console.log(`\n${ui.ok(ui.bold(ui.green('Dashboard deployed.')))}`);
  console.log(`  ${ui.dim('Address:')}  ${ui.url(url)}`);
  console.log(`  ${ui.dim('Allowed:')}  ${users.join(', ')}`);
  const auth = JSON.parse(await getSecret(outputs['SecretArn']!)) as { githubClientId?: string };
  if (!auth.githubClientId || opts.configure) await configure(global, url);
  else console.log(`\nOpen ${ui.url(url)} and sign in with GitHub.`);
}

/** Stores the GitHub OAuth App's id and secret, which the sign-in needs. */
async function configure(global: GlobalOptions, knownUrl?: string): Promise<void> {
  const stack = await findStack(dashboardStackName(global.stackName));
  if (!stack) throw new Error('The dashboard is not deployed. Run: shipzy dashboard --deploy');
  const outputs = outputsOf(stack);
  const url = knownUrl ?? outputs['DashboardUrl']!.replace(/\/$/, '');

  console.log(`\n${ui.bold('Sign-in with GitHub')}`);
  console.log('Create an OAuth App at https://github.com/settings/developers (OAuth Apps, then New OAuth App):');
  console.log(`  Homepage URL:               ${ui.url(url)}`);
  console.log(`  Authorization callback URL: ${ui.url(`${url}/auth/callback`)}`);
  console.log('Then generate a client secret.\n');
  if (!process.stdin.isTTY) {
    console.log(`Run this in a terminal to enter the client ID and secret: ${ui.accent('shipzy dashboard --configure')}`);
    return;
  }
  const clientId = await ask('Client ID: ');
  if (!/^[A-Za-z0-9._-]{8,60}$/.test(clientId)) throw new Error('That does not look like a client ID.');
  const clientSecret = await promptHidden('Client secret (input hidden): ');
  if (!/^[A-Za-z0-9._-]{16,100}$/.test(clientSecret)) throw new Error('That does not look like a client secret.');

  const arn = outputs['SecretArn']!;
  const current = JSON.parse(await getSecret(arn)) as Record<string, string>;
  await putSecret(arn, JSON.stringify({ ...current, githubClientId: clientId, githubClientSecret: clientSecret }));
  console.log(`\n${ui.ok('Saved in AWS Secrets Manager.')} A running dashboard picks it up within seconds.`);
  console.log(`Open ${ui.url(url)} and sign in with GitHub.`);
}

async function remove(global: GlobalOptions): Promise<void> {
  const name = dashboardStackName(global.stackName);
  const stack = await findStack(name);
  if (!stack) return console.log('The hosted dashboard is not deployed.');
  const bucket = outputsOf(stack)['JobsBucketName'];
  if (bucket) {
    // A bucket must be empty before it can be deleted.
    const client = s3();
    for (;;) {
      const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000 }));
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length === 0) break;
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
    }
  }
  await removeStack(name);
  console.log(ui.ok('The hosted dashboard is removed. Your sites and projects are untouched.'));
}
