import { colorStatus, ui } from '../lib/ui.js';
import { getOutputs, GlobalOptions } from '../lib/aws.js';
import { duration, envOf, recentBuilds, shortId } from '../lib/builds.js';
import { table, timeAgo } from '../lib/format.js';

export interface BuildsOptions {
  project?: string;
  limit: string;
  json?: boolean;
}

export async function builds(opts: BuildsOptions, global: GlobalOptions): Promise<void> {
  const out = await getOutputs(global.stackName);
  if (!out.buildProject) throw new Error('This stack has no build support yet. Run `shipzy init` to add it.');

  const limit = Number(opts.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a whole number >= 1.');
  // The build list is per stack, so fetch a window and filter by project afterwards.
  const recent = await recentBuilds(out.buildProject, opts.project ? 50 : limit);
  const shown = (opts.project ? recent.filter((b) => envOf(b, 'DEPLOY_PROJECT') === opts.project) : recent).slice(0, limit);

  const rows = shown.map((b) => {
    const repo = envOf(b, 'SOURCE_REPO');
    return {
      build: shortId(b),
      id: b.id,
      project: envOf(b, 'DEPLOY_PROJECT') ?? '-',
      status: b.buildStatus ?? '-',
      source: repo ? `${repo}@${(envOf(b, 'SOURCE_REF') ?? '').slice(0, 7)}` : envOf(b, 'SOURCE_TYPE') === 's3' ? 'local upload' : '-',
      deployment: envOf(b, 'DEPLOY_ID') ?? '-',
      startedAt: b.startTime?.toISOString(),
      duration: duration(b),
    };
  });

  if (opts.json) return console.log(JSON.stringify(rows, null, 2));
  if (rows.length === 0) return console.log('No builds yet. Try `shipzy deploy <dir> --remote`.');
  console.log(
    table(
      ['BUILD', 'PROJECT', 'STATUS', 'SOURCE', 'DEPLOYMENT', 'STARTED', 'TOOK'],
      rows.map((r) => [r.build, ui.name(r.project), colorStatus(r.status), r.source, r.deployment, timeAgo(r.startedAt), r.duration]),
    ),
  );
  console.log(ui.dim('\nLogs: shipzy logs <build>'));
}
