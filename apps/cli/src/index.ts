#!/usr/bin/env node
import * as dns from 'node:dns';
import * as net from 'node:net';
import { Command } from 'commander';
import { configureEnv, errorMessage, GlobalOptions } from './lib/aws.js';
import { uiErr } from './lib/ui.js';
import { builds } from './commands/builds.js';
import { dashboard } from './commands/dashboard.js';
import { deploy } from './commands/deploy.js';
import { deleteProject } from './commands/delete.js';
import { domainAdd, domainList, domainRemove, domainVerify } from './commands/domain.js';
import { envImport, envList, envRemove, envSet } from './commands/env.js';
import { destroy } from './commands/destroy.js';
import { connect, disconnect, githubDeploy, rotateSecret } from './commands/github.js';
import { init } from './commands/init.js';
import { list } from './commands/list.js';
import { logs } from './commands/logs.js';
import { previewsList, previewsRemove } from './commands/previews.js';
import { pruneCommand } from './commands/prune.js';
import { repoDeploy } from './commands/repo-deploy.js';
import { rollback } from './commands/rollback.js';
import { status } from './commands/status.js';
import { DEFAULT_GRACE_MINUTES, DEFAULT_KEEP } from '@deployer/core';

// Some networks advertise IPv6 but drop it, and Node's connection racing then stalls AWS
// requests (notably the KeyValueStore endpoint). Try IPv4 first and connect to one address
// at a time; IPv6 is still used for hosts that only have it.
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily(false);

// Injected by the bundler; plain `tsc` builds (and tests) have no value for it.
declare const __DEPLOYER_VERSION__: string | undefined;

const program = new Command()
  .name('deployer')
  .version(typeof __DEPLOYER_VERSION__ === 'undefined' ? 'dev' : __DEPLOYER_VERSION__)
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

program
  .command('dashboard')
  .description('Open a local web dashboard (runs on this computer only)')
  .option('--port <number>', 'port to listen on (127.0.0.1 only)', '4173')
  .option('--no-open', 'do not open the browser')
  .option('--install', 'download or update the dashboard (an optional extra) before starting it')
  .action((opts) => dashboard(opts, globals()));

program.command('init').description('Create or update the AWS stack').action(() => init(globals()));

program
  .command('deploy [dir]')
  .description('Build a React app and deploy it (from a folder, or from a GitHub repository with --repo)')
  .option('--repo <repository>', 'deploy a GitHub repository instead of a folder: owner/name or a github.com address (built in AWS; public repositories need no token)')
  .option('--branch <name>', 'with --repo: the branch to deploy (default: the repository default branch)')
  .option('-p, --project <name>', 'project name (default: from package.json)')
  .option('--host <hostname>', 'host to serve on (default: the CloudFront domain)')
  .option('--skip-build', 'upload the existing dist/ or build/ folder as is')
  .option('--remote', 'build in CodeBuild in your AWS account instead of on this machine')
  .option('--detach', 'with --remote: start the build and return without waiting')
  .option('--install-command <cmd>', 'replace the install step, e.g. "npm ci --legacy-peer-deps"')
  .option('--build-command <cmd>', 'replace the build step (default: <package manager> run build)')
  .option('--keep <n>', 'deployments to retain per project (live ones are always kept)', String(DEFAULT_KEEP))
  .action((dir: string | undefined, opts) => {
    if (opts.repo) {
      if (dir) throw new Error('Give either a folder or --repo, not both.');
      if (opts.remote) throw new Error('--remote is implied by --repo (repositories are always built in AWS).');
      return repoDeploy(opts.repo, opts, globals());
    }
    if (!dir) throw new Error('Give the folder to deploy, or --repo <repository>.');
    if (opts.branch) throw new Error('--branch only applies with --repo.');
    return deploy(dir, opts, globals());
  });

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

const domain = program.command('domain').description('Serve a project on your own domain (certificate, distribution and DNS)');

domain
  .command('add <host>')
  .description('Add a custom domain to a project (creates the certificate and distribution; DNS too, if the domain is in Route 53)')
  .option('-p, --project <name>', 'the project that serves this domain')
  .option('--preview', 'a wildcard domain (e.g. "*.preview.example.com") that serves pull request previews of every project')
  .option('--manual', 'print the DNS records instead of creating them, even if a Route 53 zone exists')
  .option('--no-wait', 'do not wait for the certificate and DNS; rerun the command to continue')
  .action((host, opts) => domainAdd(host, opts, globals()));

domain
  .command('ls')
  .alias('list')
  .description('List custom domains with their certificate and DNS state')
  .option('-p, --project <name>')
  .option('--json', 'machine-readable output')
  .action((opts) => domainList(opts, globals()));

domain
  .command('verify <host>')
  .description('Check what is in place for a domain and what is still missing')
  .action((host) => domainVerify(host, globals()));

domain
  .command('rm <host>')
  .description('Remove a custom domain: route, distribution, certificate and the DNS records this tool created')
  .option('-y, --yes', 'skip the confirmation prompt')
  .action((host, opts) => domainRemove(host, opts, globals()));

const env = program.command('env').description('Build-time environment variables for remote and GitHub builds');

env
  .command('set <name> [value]')
  .description('Set a variable (NAME VALUE, NAME=VALUE, or just NAME to type or pipe the value)')
  .requiredOption('-p, --project <name>')
  .option('--preview', 'a value used only by preview builds (overrides the production value there)')
  .action((name, value, opts) => envSet(name, value, opts, globals()));

env
  .command('import <file>')
  .description('Set every variable in a .env file')
  .requiredOption('-p, --project <name>')
  .option('--preview', 'import as preview-only overrides')
  .action((file, opts) => envImport(file, opts, globals()));

env
  .command('ls')
  .alias('list')
  .description("List a project's variable names (values are never shown)")
  .requiredOption('-p, --project <name>')
  .option('--json', 'machine-readable output')
  .action((opts) => envList(opts, globals()));

env
  .command('rm <name>')
  .description('Remove a variable')
  .requiredOption('-p, --project <name>')
  .option('--preview', 'remove the preview override')
  .action((name, opts) => envRemove(name, opts, globals()));

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
  .option('--previews', 'also build a preview URL for every pull request into the branch (needs a preview domain)')
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

const previews = program.command('previews').description('Pull request previews: one URL per open pull request');

previews
  .command('ls', { isDefault: true })
  .alias('list')
  .description('List the preview domain and the open previews')
  .option('-p, --project <name>')
  .option('--json', 'machine-readable output')
  .action((opts) => previewsList(opts, globals()));

previews
  .command('rm <pr>')
  .description('Take one preview down by hand (closing the pull request does this too)')
  .requiredOption('-p, --project <name>')
  .action((pr, opts) => previewsRemove(pr, opts, globals()));

program
  .command('rollback')
  .description('Point a host back at a previous deployment (instant)')
  .requiredOption('-p, --project <name>')
  .option('--to <deploymentId>', 'deployment to serve (default: the one before the live one)')
  .option('--host <hostname>', 'host to roll back (default: every host the project is live on)')
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

// Exit explicitly so keep-alive sockets cannot hold the process open, and so a failure exit code set by a
// command (process.exitCode) is what the shell sees.
program
  .parseAsync()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(`${uiErr.red(uiErr.bold('Error:'))} ${errorMessage(err)}`);
    process.exit(1);
  });
