// Demo mode (`shipzy dashboard --demo`): the dashboard runs on sample data and scripted actions, touching nothing in
// AWS. It exists so people can try the dashboard before connecting an account, and so the documentation can show real
// screens without anyone's account details in them. Everything here is invented: the account number, the names and
// the example.com addresses.

export const demoEnabled = () => process.env.SHIPZY_DEMO === '1';

const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const pad = (n: number) => String(n).padStart(2, '0');
/** A deployment id for a moment in the past, in the real format: d-20261028T212416-f8ca7f. */
function deploymentId(msAgo: number, salt: string): string {
  const d = new Date(Date.now() - msAgo);
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  let hash = 0;
  for (const ch of `${salt}${msAgo}`) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  return `d-${stamp}-${hash.toString(16).padStart(8, '0').slice(0, 6)}`;
}

interface Demo {
  name: string;
  framework: 'vite' | 'next-static' | 'create-react-app';
  repo?: string;
  branch?: string;
  previews?: boolean;
  openPreviews?: number[];
  domains: string[];
  siteHost?: string;
  /** minutes since each deployment, newest last */
  ages: number[];
  live: boolean;
  bytes: number;
  files: number;
  env: { production: string[]; preview: string[] };
}

const PROJECTS: Demo[] = [
  {
    name: 'acme-site',
    framework: 'next-static',
    repo: 'example/acme-site',
    branch: 'main',
    previews: true,
    openPreviews: [14, 15],
    domains: ['www.example.com'],
    siteHost: 'd1a2b3c4d5e6f7.cloudfront.net',
    ages: [9000, 5200, 2900, 1500, 800, 310, 95, 12],
    live: true,
    bytes: 18_400_000,
    files: 142,
    env: { production: ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_SITE_NAME'], preview: ['NEXT_PUBLIC_API_URL'] },
  },
  {
    name: 'docs',
    framework: 'vite',
    repo: 'example/docs',
    branch: 'main',
    domains: ['docs.example.com'],
    siteHost: 'd2b3c4d5e6f7a8.cloudfront.net',
    ages: [20000, 12000, 7000, 4000, 2500, 900, 380, 140, 61, 33],
    live: true,
    bytes: 6_200_000,
    files: 64,
    env: { production: ['VITE_SEARCH_KEY'], preview: [] },
  },
  {
    name: 'store-frontend',
    framework: 'vite',
    domains: [],
    siteHost: 'd3c4d5e6f7a8b9.cloudfront.net',
    ages: [4300, 2100, 720, 180],
    live: true,
    bytes: 9_800_000,
    files: 88,
    env: { production: ['VITE_API_URL', 'VITE_STRIPE_KEY', 'VITE_SENTRY_DSN', 'VITE_FLAGS_URL', 'VITE_SITE_URL'], preview: ['VITE_API_URL'] },
  },
  {
    name: 'blog',
    framework: 'next-static',
    repo: 'example/blog',
    branch: 'main',
    domains: [],
    siteHost: 'd4d5e6f7a8b9c0.cloudfront.net',
    ages: [15000, 8600, 3000, 1100, 420, 75],
    live: true,
    bytes: 11_300_000,
    files: 117,
    env: { production: [], preview: [] },
  },
  {
    name: 'playground',
    framework: 'create-react-app',
    domains: [],
    ages: [30000],
    live: false,
    bytes: 2_400_000,
    files: 31,
    env: { production: [], preview: [] },
  },
];

const hostsOf = (p: Demo) => (!p.live ? [] : [...p.domains, ...(p.siteHost ? [p.siteHost] : [])]);
const ids = (p: Demo) => p.ages.map((a, i) => deploymentId(a * MIN, `${p.name}${i}`));
const latest = (p: Demo) => ids(p).at(-1)!;
const envNames = (p: Demo) => new Set([...p.env.production, ...p.env.preview]);
const find = (name?: string) => PROJECTS.find((p) => p.name === name);

function summary(p: Demo) {
  const id = latest(p);
  return {
    name: p.name,
    live: hostsOf(p).map((host) => ({ host, deploymentId: id, deployedAt: ago(p.ages.at(-1)! * MIN) })),
    versions: p.ages.length,
    lastDeployedAt: ago(p.ages.at(-1)! * MIN),
    bytes: p.bytes,
    files: p.files,
    source: p.repo ? { repo: p.repo, branch: p.branch ?? 'main', previews: Boolean(p.previews) } : undefined,
    previews: p.openPreviews?.length ?? 0,
    domains: p.domains,
    envVars: envNames(p).size,
  };
}

function manifest(p: Demo) {
  const all = ids(p);
  const id = all.at(-1)!;
  return {
    project: p.name,
    deployments: all.map((did, i) => ({
      id: did,
      createdAt: ago(p.ages[i]! * MIN),
      files: p.files - (p.ages.length - 1 - i) * 2,
      framework: p.framework,
      routing: p.framework === 'next-static' ? 'html' : undefined,
    })),
    live: Object.fromEntries(hostsOf(p).map((h) => [h, id])),
    source: p.repo ? { type: 'github', repo: p.repo, branch: p.branch ?? 'main', previews: Boolean(p.previews) } : undefined,
    env: p.env.production.length || p.env.preview.length ? p.env : undefined,
    domains: p.domains.length ? p.domains : undefined,
    siteHost: p.siteHost,
    previews: p.openPreviews
      ? Object.fromEntries(p.openPreviews.map((pr, i) => [String(pr), { host: `${p.name}-pr-${pr}.preview.example.com`, id: deploymentId((40 + i * 25) * MIN, `${p.name}pr${pr}`), sha: '3f9c2ab', updatedAt: ago((40 + i * 25) * MIN) }]))
      : undefined,
  };
}

function domainRows(only?: string) {
  const rows = PROJECTS.flatMap((p) =>
    p.domains.map((host, i) => ({ host, project: p.name, stack: 'CREATE_COMPLETE', certificate: 'ISSUED', dns: 'ok', distribution: `d${i + 5}e6f7a8b9c0d1.cloudfront.net` })),
  );
  if (!only) rows.push({ host: '*.preview.example.com', project: '(previews)', stack: 'CREATE_COMPLETE', certificate: 'ISSUED', dns: 'ok', distribution: 'd9f0a1b2c3d4e5.cloudfront.net' });
  return only ? rows.filter((r) => r.project === only) : rows;
}

function buildRows(p: Demo) {
  const all = ids(p);
  return all
    .slice(-4)
    .reverse()
    .map((did, i) => ({
      build: `${did.slice(-6)}${i}`.slice(0, 8),
      id: `Build45A36621-demo:${did.slice(-12)}`,
      project: p.name,
      status: 'SUCCEEDED',
      source: p.repo ? `${p.repo}@${['3f9c2ab', 'a81d0e4', '5be7721', 'c04f9d8'][i]}` : 'local upload',
      deployment: did,
      startedAt: ago((p.ages.at(-1 - i)! + 2) * MIN),
      duration: ['1m 42s', '1m 37s', '1m 51s', '1m 33s'][i]!,
    }));
}

/** What `shipzy <args> --json` would print, for the commands the dashboard reads. Undefined when not covered. */
export function demoRead(args: string[]): unknown {
  const a = args.filter((x) => x !== '--json');
  const at = a.indexOf('-p');
  const project = at >= 0 ? a[at + 1] : undefined;
  if (a[0] === 'status') {
    const live = PROJECTS.flatMap(hostsOf).length;
    return {
      demo: true,
      account: '123456789012',
      identity: 'arn:aws:iam::123456789012:user/shipzy-cli',
      region: 'us-east-1',
      stack: { name: 'Deployer', status: 'UPDATE_COMPLETE', updated: ago(3 * 24 * 60 * MIN) },
      bucket: 'deployer-sites-0a1b2c3d4e5f',
      distribution: { id: 'E1ABCDEF2GHIJK', url: 'https://d0a1b2c3d4e5f6.cloudfront.net' },
      builds: { project: 'Build45A36621-demo', engine: true, webhookUrl: 'https://example.lambda-url.us-east-1.on.aws/', last: { status: 'SUCCEEDED', project: 'acme-site', startedAt: ago(12 * MIN), took: '1m 42s' } },
      githubProjects: PROJECTS.filter((p) => p.repo).length,
      domains: PROJECTS.reduce((n, p) => n + p.domains.length, 0),
      previewDomains: ['preview.example.com'],
      openPreviews: PROJECTS.reduce((n, p) => n + (p.openPreviews?.length ?? 0), 0),
      envVars: PROJECTS.reduce((n, p) => n + envNames(p).size, 0),
      projects: PROJECTS.length,
      deployments: PROJECTS.reduce((n, p) => n + p.ages.length, 0),
      liveSites: live,
      bytes: PROJECTS.reduce((n, p) => n + p.bytes, 0),
    };
  }
  if (a[0] === 'list') {
    if (!project) return [...PROJECTS].map(summary);
    const p = find(project);
    return p ? manifest(p) : undefined;
  }
  if (a[0] === 'domain' && a[1] === 'ls') return domainRows(project);
  if (a[0] === 'env' && a[1] === 'ls') {
    const p = find(project);
    if (!p) return undefined;
    return [...envNames(p)].map((name) => ({ name, production: p.env.production.includes(name), preview: p.env.preview.includes(name) }));
  }
  if (a[0] === 'builds') {
    const p = find(project);
    return p ? buildRows(p) : undefined;
  }
  if (a[0] === 'previews') {
    const p = find(project);
    if (!p) return undefined;
    return {
      bases: ['preview.example.com'],
      previews: (p.openPreviews ?? []).map((pr, i) => ({
        project: p.name,
        pr,
        host: `${p.name}-pr-${pr}.preview.example.com`,
        url: `https://${p.name}-pr-${pr}.preview.example.com`,
        deployment: deploymentId((40 + i * 25) * MIN, `${p.name}pr${pr}`),
        sha: '3f9c2ab1d4e8',
        updatedAt: ago((40 + i * 25) * MIN),
        serving: true,
      })),
    };
  }
  return undefined;
}

type Line = [delayMs: number, text: string];

/** A believable log for an action. Nothing runs: the lines are played back with short pauses. */
export function demoScript(args: string[]): Line[] {
  const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const project = flag('-p') ?? flag('--project') ?? 'acme-site';
  const p = find(project);
  const id = deploymentId(0, `${project}${Date.now()}`);
  const host = p?.domains[0] ?? p?.siteHost ?? 'd1a2b3c4d5e6f7.cloudfront.net';
  const next = p?.framework === 'next-static';

  switch (args[0]) {
    case 'deploy':
    case 'github': {
      if (args[0] === 'github' && args[1] !== 'deploy' && args[1] !== 'connect') break;
      const connect = args[0] === 'github' && args[1] === 'connect';
      if (connect) {
        return [
          [300, `Connected ${project} to ${flag('--repo') ?? 'example/acme-site'} (main): webhook created (id 512340987).`],
          [200, 'Every push to main now builds and deploys to ' + host + '.'],
          [100, `Deploy the current head now with: shipzy github deploy -p ${project}`],
        ];
      }
      return [
        [250, `Building ${p?.repo ?? 'example/acme-site'}@3f9c2ab (main)`],
        [300, `Started build 9d41c0f2 for ${project}`],
        [500, '[Container] Phase is DOWNLOAD_SOURCE'],
        [400, '==> Fetching source (github)'],
        [500, '==> Installing: npm ci'],
        [600, 'added 214 packages, and audited 215 packages in 6s'],
        [400, '==> Building: npm run build'],
        ...(next
          ? ([
              [500, '▲ Next.js 16.4.1 (Turbopack)'],
              [500, '✓ Generating static pages using 6 workers (12/12) in 312ms'],
              [200, 'Route (app)'],
              [100, '┌ ○ /'],
              [100, '├ ○ /about'],
              [100, '└ ● /blog/[slug]'],
            ] as Line[])
          : ([
              [500, 'vite v7.2.2 building client environment for production...'],
              [400, '✓ 612 modules transformed.'],
              [300, 'dist/index.html                     0.47 kB'],
              [100, 'dist/assets/index-DFuwUrAn.js   312.18 kB'],
              [200, '✓ built in 5.77s'],
            ] as Line[])),
        [500, `==> Uploading ${next ? 'out' : 'dist'} to s3://deployer-sites-0a1b2c3d4e5f/${project}/${id}`],
        [500, `==> Promoting ${project}/${id}`],
        [300, `Live: https://${host}`],
        [100, '(Routing changes propagate to the edge in roughly 30 seconds.)'],
      ];
    }
    case 'rollback':
      return [[300, `https://${host} now serves ${deploymentId(95 * MIN, `${project}6`)}`]];
    case 'prune':
      return [[300, args.includes('--dry-run') ? 'Nothing to prune.' : 'Cleaned up 0 old deployments.']];
    case 'env':
      return [[300, `Set ${args[2] ?? 'NEXT_PUBLIC_API_URL'} for production builds of ${project}.`], [100, 'Applies to the next build, not to what is live now.']];
    case 'domain':
      return [
        [300, 'DNS: using the Route 53 zone example.com; the records are created for you.'],
        [500, 'Requesting a certificate...'],
        [600, 'Added the certificate validation record to Route 53.'],
        [700, 'Certificate issued.'],
        [600, `Creating the distribution for ${args[2] ?? 'app.example.com'} (about 5 minutes)...`],
        [600, `Created the DNS alias ${args[2] ?? 'app.example.com'} in Route 53.`],
        [300, `Live: https://${args[2] ?? 'app.example.com'}`],
      ];
    default:
      break;
  }
  return [[300, 'Demo mode: this action is only simulated, nothing was changed in AWS.']];
}
