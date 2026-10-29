#!/usr/bin/env node
import * as dns from 'node:dns';
import * as net from 'node:net';
import { Command } from 'commander';
import { configureEnv, errorMessage, GlobalOptions } from './lib/aws.js';
import { builds } from './commands/builds.js';
import { deploy } from './commands/deploy.js';
import { deleteProject } from './commands/delete.js';
import { destroy } from './commands/destroy.js';
import { connect, disconnect, githubDeploy, rotateSecret } from './commands/github.js';
import { init } from './commands/init.js';
import { list } from './commands/list.js';
import { logs } from './commands/logs.js';
import { pruneCommand } from './commands/prune.js';
import { rollback } from './commands/rollback.js';
import { status } from './commands/status.js';
import { DEFAULT_GRACE_MINUTES, DEFAULT_KEEP } from '@deployer/core';

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
  .option('--remote', 'build in CodeBuild in your AWS account instead of on this machine')
  .option('--detach', 'with --remote: start the build and return without waiting')
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
  .command('builds')
  .description('List recent remote builds')
  .option('-p, --project <name>', 'only builds of this project')
  .option('--limit <n>', 'how many to show', '10')
  .option('--json', 'machine-readable output')
  .action((opts) => builds(opts, globals()));

program
  .command('logs <build>')
  .description('Show the log of a remote build (id as shown by `deployer builds`)')
  .option('-f, --follow', 'keep streaming until the build finishes')
  .action((build, opts) => logs(build, opts, globals()));

const github = program.command('github').description('Deploy a project automatically when its GitHub repository is pushed to');

github
  .command('connect')
  .description('Connect a project to a repository and register the push webhook')
  .requiredOption('-p, --project <name>')
  .requiredOption('--repo <owner/name>', 'repository to deploy from')
  .option('--branch <name>', 'branch to deploy (default: the repository default branch)')
  .option('--host <hostname>', 'host to deploy to (default: the CloudFront domain)')
  .option('--install-command <cmd>', 'replace the install step for these builds')
  .option('--build-command <cmd>', 'replace the build step for these builds')
  .option('--reuse-token', 'use the GitHub token already stored in your account instead of asking for one')
  .action((opts) => connect(opts, globals()));

github
  .command('deploy')
  .description('Build the current head of the connected branch now')
  .requiredOption('-p, --project <name>')
  .option('--detach', 'start the build and return without waiting')
  .action((opts) => githubDeploy(opts, globals()));

github
  .command('rotate-secret')
  .description('Replace the webhook signing secret and update the webhook on every connected repository')
  .action(() => rotateSecret(globals()));

github
  .command('disconnect')
  .description('Stop deploying a project from GitHub and remove its webhook')
  .requiredOption('-p, --project <name>')
  .action((opts) => disconnect(opts, globals()));

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
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(`Error: ${errorMessage(err)}`);
    process.exit(1);
  });
