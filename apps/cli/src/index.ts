#!/usr/bin/env node
import * as dns from 'node:dns';
import * as net from 'node:net';
import { Command } from 'commander';
import { configureEnv, errorMessage, GlobalOptions } from './lib/aws.js';
import { deploy } from './commands/deploy.js';
import { deleteProject } from './commands/delete.js';
import { destroy } from './commands/destroy.js';
import { init } from './commands/init.js';
import { list } from './commands/list.js';
import { pruneCommand } from './commands/prune.js';
import { rollback } from './commands/rollback.js';
import { status } from './commands/status.js';
import { DEFAULT_GRACE_MINUTES, DEFAULT_KEEP } from './lib/prune.js';

// Some networks advertise IPv6 but drop it, and Node's connection racing then stalls AWS
// requests (notably the KeyValueStore endpoint). Try IPv4 first and connect to one address
// at a time; IPv6 is still used for hosts that only have it.
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily(false);

const program = new Command()
  .name('deployer')
  .description('Deploy static React apps to your own AWS account (S3 + CloudFront)')
  .option('--profile <name>', 'AWS profile to use')
  .option('--region <region>', 'AWS region (default: AWS_REGION or us-east-1)')
  .option('--stack-name <name>', 'CloudFormation stack name', 'Deployer');

// Resolve global options and AWS environment once, before any command runs.
function globals(): GlobalOptions {
  const opts = program.opts<GlobalOptions>();
  configureEnv(opts);
  return opts;
}

program.command('init').description('Create or update the AWS stack').action(() => init(globals()));

program
  .command('deploy <dir>')
  .description('Build a React app and deploy it')
  .option('-p, --project <name>', 'project name (default: from package.json)')
  .option('--host <hostname>', 'host to serve on (default: the CloudFront domain)')
  .option('--skip-build', 'upload the existing dist/ or build/ folder as is')
  .option('--install-command <cmd>', 'replace the install step, e.g. "npm ci --legacy-peer-deps"')
  .option('--build-command <cmd>', 'replace the build step (default: <package manager> run build)')
  .option('--keep <n>', 'deployments to retain per project (live ones are always kept)', String(DEFAULT_KEEP))
  .action((dir, opts) => deploy(dir, opts, globals()));

program
  .command('list')
  .alias('ls')
  .description('List deployed projects, or the deployments of one project')
  .option('-p, --project <name>', 'show the deployments of one project')
  .option('--json', 'machine-readable output')
  .action((opts) => list(opts, globals()));

program
  .command('status')
  .description('Show the account, stack, CloudFront URL and totals')
  .option('--json', 'machine-readable output')
  .action((opts) => status(opts, globals()));

program
  .command('rollback')
  .description('Point a host back at a previous deployment (instant)')
  .requiredOption('-p, --project <name>')
  .option('--to <deploymentId>', 'deployment to serve (default: the one before the live one)')
  .option('--host <hostname>', 'host to roll back (default: the CloudFront domain)')
  .action((opts) => rollback(opts, globals()));

program
  .command('prune')
  .description('Delete old deployments and uploads that were never promoted')
  .requiredOption('-p, --project <name>')
  .option('--keep <n>', 'newest deployments to retain (live ones are always kept)', String(DEFAULT_KEEP))
  .option('--grace-minutes <n>', 'leave unrecorded uploads newer than this alone', String(DEFAULT_GRACE_MINUTES))
  .option('--dry-run', 'show what would be deleted')
  .action((opts) => pruneCommand(opts, globals()));

program
  .command('delete')
  .alias('rm')
  .description('Delete one project: its deployments, history and routes')
  .requiredOption('-p, --project <name>')
  .option('-y, --yes', 'skip the confirmation prompt')
  .option('--dry-run', 'show what would be deleted')
  .action((opts) => deleteProject(opts, globals()));

program
  .command('destroy')
  .description('Delete all deployments and the AWS stack')
  .option('-y, --yes', 'skip the confirmation prompt')
  .action((opts) => destroy(opts, globals()));

// The CRT module (needed for KeyValueStore SigV4a) keeps the event loop alive,
// so exit explicitly once the command has finished.
program
  .parseAsync()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`Error: ${errorMessage(err)}`);
    process.exit(1);
  });
