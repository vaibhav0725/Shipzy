import { getOutputs, GlobalOptions } from '../lib/aws.js';
import { describeFailure, resolveBuildId, streamLogs } from '../lib/builds.js';

export async function logs(buildArg: string, opts: { follow?: boolean }, global: GlobalOptions): Promise<void> {
  const out = await getOutputs(global.stackName);
  if (!out.buildProject) throw new Error('This stack has no build support yet. Run `shipzy init` to add it.');

  const build = await streamLogs(await resolveBuildId(out.buildProject, buildArg), Boolean(opts.follow));
  if (!build.buildComplete) {
    console.log('\n(build still running; add -f to follow it)');
  } else if (build.buildStatus !== 'SUCCEEDED') {
    process.exitCode = 1;
    console.error(`\n${describeFailure(build)}`);
  }
}
