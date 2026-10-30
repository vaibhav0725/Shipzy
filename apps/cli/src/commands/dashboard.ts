import { ui } from '../lib/ui.js';
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { GlobalOptions } from '../lib/aws.js';
import { ensureDashboard } from '../lib/dashboard-app.js';

export interface DashboardOptions {
  port: string;
  /** commander turns --no-open into open: false */
  open: boolean;
  /** download (or update) the optional dashboard package first, without asking */
  install?: boolean;
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

function waitForPort(port: number, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (child.exitCode !== null) return reject(new Error('The dashboard server stopped before it was ready.'));
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) return reject(new Error('The dashboard server did not start in time.'));
        setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
  } catch {
    /* the URL is printed anyway */
  }
}

/** Runs the dashboard (an optional package, installed on demand) on this machine, for this machine only. */
export async function dashboard(opts: DashboardOptions, global: GlobalOptions): Promise<void> {
  const port = Number(opts.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port must be a number from 1024 to 65535.');

  const server = await ensureDashboard(Boolean(opts.install));
  if (!(await canListen(port))) throw new Error(`Port ${port} is already in use. Pick another with --port.`);

  const token = randomBytes(24).toString('base64url');
  const cli = fs.realpathSync(process.argv[1]!);
  const child = spawn(process.execPath, [server], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      // Next's standalone server reads these. Listen on this machine only.
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      DEPLOYER_DASH_TOKEN: token,
      DEPLOYER_CLI: cli,
      DEPLOYER_CWD: process.cwd(),
      DEPLOYER_GLOBALS: JSON.stringify({ profile: global.profile, region: process.env.AWS_REGION, stackName: global.stackName }),
    },
  });

  let stderr = '';
  child.stderr!.on('data', (d: Buffer) => (stderr = (stderr + d).slice(-2000)));

  const stop = () => {
    if (child.exitCode === null) child.kill('SIGTERM');
  };
  process.on('exit', stop);
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      console.log('\nStopping the dashboard...');
      stop();
    });
  }

  await waitForPort(port, child, 20_000).catch((err) => {
    stop();
    throw new Error(`${err.message}${stderr ? `\n${stderr.trim()}` : ''}`);
  });

  const url = `http://127.0.0.1:${port}/?token=${token}`;
  console.log(ui.ok(`${ui.bold('Dashboard running')} for stack ${ui.name(`"${global.stackName}"`)} (${process.env.AWS_REGION}).`));
  console.log(`\n  ${ui.url(url)}\n`);
  console.log(ui.dim('Open that address (it signs your browser in; the link is only good for this run). Press Ctrl-C to stop.'));
  console.log(ui.dim('Actions you start here run on this computer, using your AWS profile, exactly like the CLI.'));
  if (opts.open) openBrowser(url);

  const code = await exited;
  if (code && code !== 143 && code !== 130) {
    throw new Error(`The dashboard server exited with code ${code}.${stderr ? `\n${stderr.trim()}` : ''}`);
  }
}
