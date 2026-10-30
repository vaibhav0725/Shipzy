import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runJson } from './cli';
import { sessionToken } from './github';
import type { Step } from './jobs';
import * as v from './validate';
import { InputError } from './validate';

export interface ActionPlan {
  label: string;
  project?: string;
  steps: Step[];
  /** values to blank out of the job's output, in case a command echoes them */
  secrets?: string[];
  cleanup?: () => void;
}

type Body = Record<string, unknown>;

/** `--flag=value`, so the value can never be read as a separate option. */
const withValue = (flag: string, value: string | undefined): string[] => (value === undefined ? [] : [`${flag}=${value}`]);

export async function planAction(body: Body): Promise<ActionPlan> {
  const action = body.action;
  switch (action) {
    case 'deploy-folder': {
      const dir = v.absolutePath(body.dir);
      let stat: fs.Stats | undefined;
      try {
        stat = fs.statSync(dir);
      } catch {
        /* reported below */
      }
      if (!stat?.isDirectory()) throw new InputError(`"${dir}" is not a folder on this machine.`);
      const project = v.project(body.project);
      const host = body.host ? v.host(body.host) : undefined;
      const remote = v.flag(body.remote);
      const keep = v.keep(body.keep);
      return {
        label: `Deploy ${project}${remote ? ' (build in AWS)' : ''}`,
        project,
        steps: [
          {
            args: [
              'deploy',
              dir,
              '-p',
              project,
              ...(remote ? ['--remote'] : []),
              ...(host ? ['--host', host] : []),
              ...withValue('--install-command', v.command(body.installCommand, 'The install command')),
              ...withValue('--build-command', v.command(body.buildCommand, 'The build command')),
              ...(keep ? ['--keep', keep] : []),
            ],
          },
        ],
      };
    }

    case 'deploy-repo': {
      // A one-time deploy of a pasted repository link. Public repositories need no token.
      const project = v.project(body.project);
      const parsed = v.repoInput(body.repo);
      const branch = body.branch ? v.branch(body.branch) : parsed.branch;
      const host = body.host ? v.host(body.host) : undefined;
      return {
        label: `Deploy ${parsed.repo} as ${project}`,
        project,
        steps: [
          {
            args: [
              'deploy',
              '--repo',
              parsed.repo,
              '-p',
              project,
              ...(branch ? ['--branch', branch] : []),
              ...(host ? ['--host', host] : []),
              ...withValue('--install-command', v.command(body.installCommand, 'The install command')),
              ...withValue('--build-command', v.command(body.buildCommand, 'The build command')),
            ],
          },
        ],
      };
    }

    case 'deploy-github': {
      const project = v.project(body.project);
      const parsed = v.repoInput(body.repo);
      const repo = parsed.repo;
      const branch = body.branch ? v.branch(body.branch) : parsed.branch;
      const host = body.host ? v.host(body.host) : undefined;
      const reuse = v.flag(body.reuseToken);
      // Either the login made with "Connect GitHub" (held by this server, never sent by the browser) or a pasted token.
      const useLogin = v.flag(body.useLogin);
      const token = useLogin ? (sessionToken() ?? '') : typeof body.token === 'string' ? body.token.trim() : '';
      if (useLogin && !token) throw new InputError('Your GitHub login has ended. Connect GitHub again.');
      if (!reuse && !token) throw new InputError('Enter a GitHub token, or choose the token already stored in your account.');
      if (token && (token.length > 600 || /\s/.test(token))) throw new InputError('That does not look like a GitHub token.');
      return {
        label: `Connect ${project} to ${repo} and deploy`,
        project,
        secrets: token ? [token] : [],
        steps: [
          {
            args: [
              'github',
              'connect',
              '-p',
              project,
              '--repo',
              repo,
              ...(branch ? ['--branch', branch] : []),
              ...(host ? ['--host', host] : []),
              ...withValue('--install-command', v.command(body.installCommand, 'The install command')),
              ...withValue('--build-command', v.command(body.buildCommand, 'The build command')),
              ...(reuse ? ['--reuse-token'] : []),
            ],
            env: token ? { GITHUB_TOKEN: token } : undefined,
          },
          { args: ['github', 'deploy', '-p', project] },
        ],
      };
    }

    case 'github-deploy': {
      const project = v.project(body.project);
      return { label: `Build ${project} from GitHub now`, project, steps: [{ args: ['github', 'deploy', '-p', project] }] };
    }

    case 'github-disconnect': {
      const project = v.project(body.project);
      return { label: `Disconnect ${project} from GitHub`, project, steps: [{ args: ['github', 'disconnect', '-p', project] }] };
    }

    case 'rollback': {
      const project = v.project(body.project);
      const to = body.to ? v.deploymentId(body.to) : undefined;
      const host = body.host ? v.host(body.host) : undefined;
      return {
        label: `Roll back ${project}${to ? ` to ${to}` : ''}`,
        project,
        steps: [{ args: ['rollback', '-p', project, ...(to ? ['--to', to] : []), ...(host ? ['--host', host] : [])] }],
      };
    }

    case 'prune': {
      const project = v.project(body.project);
      const keep = v.keep(body.keep);
      const dry = v.flag(body.dryRun);
      return {
        label: `${dry ? 'Preview cleanup of' : 'Clean up'} ${project}`,
        project,
        steps: [{ args: ['prune', '-p', project, ...(dry ? ['--dry-run'] : []), ...(keep ? ['--keep', keep] : [])] }],
      };
    }

    case 'delete-project': {
      const project = v.project(body.project);
      return { label: `Delete ${project}`, project, steps: [{ args: ['delete', '-p', project, '--yes'] }] };
    }

    case 'domain-add': {
      const project = v.project(body.project);
      const host = v.host(body.host);
      return {
        label: `Add domain ${host}`,
        project,
        steps: [{ args: ['domain', 'add', host, '-p', project, ...(v.flag(body.manual) ? ['--manual'] : [])] }],
      };
    }

    case 'preview-domain-add': {
      const host = v.previewDomain(body.host);
      return {
        label: `Add preview domain ${host}`,
        steps: [{ args: ['domain', 'add', host, '--preview', ...(v.flag(body.manual) ? ['--manual'] : [])] }],
      };
    }

    case 'github-previews': {
      // Turning previews on or off re-runs the connection with the settings it already has.
      const project = v.project(body.project);
      const enable = v.flag(body.enable);
      const info = await runJson<{ source?: { repo: string; branch: string; host?: string; installCommand?: string; buildCommand?: string } }>(
        ['list', '-p', project, '--json'],
        0,
      );
      const src = info.source;
      if (!src) throw new InputError(`${project} is not connected to a GitHub repository.`);
      return {
        label: `${enable ? 'Turn on' : 'Turn off'} previews for ${project}`,
        project,
        steps: [
          {
            args: [
              'github',
              'connect',
              '-p',
              project,
              '--repo',
              v.repo(src.repo),
              '--branch',
              v.branch(src.branch),
              ...(src.host ? ['--host', v.host(src.host)] : []),
              ...withValue('--install-command', v.command(src.installCommand, 'The install command')),
              ...withValue('--build-command', v.command(src.buildCommand, 'The build command')),
              '--reuse-token',
              ...(enable ? ['--previews'] : []),
            ],
          },
        ],
      };
    }

    case 'preview-rm': {
      const project = v.project(body.project);
      const pr = v.pullRequest(body.pr);
      return { label: `Remove the preview of ${project} #${pr}`, project, steps: [{ args: ['previews', 'rm', pr, '-p', project] }] };
    }

    case 'domain-verify': {
      const host = v.anyHost(body.host);
      return { label: `Check domain ${host}`, steps: [{ args: ['domain', 'verify', host] }] };
    }

    case 'domain-rm': {
      const host = v.anyHost(body.host);
      return { label: `Remove domain ${host}`, steps: [{ args: ['domain', 'rm', host, '--yes'] }] };
    }

    case 'env-set': {
      const project = v.project(body.project);
      const name = v.envName(body.name);
      const value = typeof body.value === 'string' ? body.value : '';
      if (value === '') throw new InputError('Enter a value.');
      if (Buffer.byteLength(value, 'utf8') > 4096) throw new InputError('The value is larger than 4096 bytes.');
      return {
        label: `Set ${name} for ${project}`,
        project,
        secrets: [value],
        // The value goes in through standard input: never on the command line, never in the log.
        steps: [{ args: ['env', 'set', name, '-p', project, ...(v.flag(body.preview) ? ['--preview'] : [])], stdin: value }],
      };
    }

    case 'env-import': {
      const project = v.project(body.project);
      const content = typeof body.content === 'string' ? body.content : '';
      if (content.trim() === '') throw new InputError('Paste the contents of a .env file.');
      if (content.length > 100_000) throw new InputError('That file is too large.');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deployer-env-'));
      const file = path.join(dir, '.env');
      fs.writeFileSync(file, content, { mode: 0o600 });
      // Every value is a secret as far as the log is concerned.
      const secrets = content
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*(export\s+)?[^=]*=/, '').trim().replace(/^(['"])(.*)\1$/, '$2'))
        .filter((s) => s.length >= 4);
      return {
        label: `Import variables for ${project}`,
        project,
        secrets,
        cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
        steps: [{ args: ['env', 'import', file, '-p', project, ...(v.flag(body.preview) ? ['--preview'] : [])] }],
      };
    }

    case 'env-rm': {
      const project = v.project(body.project);
      const name = v.envName(body.name);
      return {
        label: `Remove ${name} from ${project}`,
        project,
        steps: [{ args: ['env', 'rm', name, '-p', project, ...(v.flag(body.preview) ? ['--preview'] : [])] }],
      };
    }

    case 'build-logs': {
      const id = v.buildId(body.build);
      return { label: `Log of build ${id}`, steps: [{ args: ['logs', id, '-f'] }] };
    }

    default:
      throw new InputError(`Unknown action "${String(action)}".`);
  }
}
