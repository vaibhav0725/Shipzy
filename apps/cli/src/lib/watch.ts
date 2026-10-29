import { describeFailure, duration, streamLogs } from './builds.js';

/**
 * Follows a build that was just started: streams its log and reports the outcome.
 * With `detach`, prints how to follow it later and returns at once.
 */
export async function watchBuild(buildId: string, hosts: string[], project: string, detach: boolean): Promise<void> {
  const short = buildId.split(':').pop()!.slice(0, 8);
  console.log(`Started build ${short} for ${project}\n`);

  if (detach) {
    console.log(`Follow it:  deployer logs ${short} -f\nAll builds: deployer builds -p ${project}`);
    return;
  }

  // Ctrl-C stops watching, not the build.
  process.once('SIGINT', () => {
    console.log(`\nStopped watching. The build keeps running; follow it with: deployer logs ${short} -f`);
    process.exit(130);
  });
  const finished = await streamLogs(buildId, true);
  if (finished.buildStatus !== 'SUCCEEDED') throw new Error(describeFailure(finished));

  console.log(`\nLive: ${hosts.map((h) => `https://${h}`).join(', ')}  (build took ${duration(finished)})`);
  console.log('(Routing changes propagate to the edge in roughly 30 seconds.)');
}
