import {
  BatchGetBuildsCommand,
  type Build,
  CodeBuildClient,
  ListBuildsForProjectCommand,
} from '@aws-sdk/client-codebuild';
import { CloudWatchLogsClient, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';

let sharedBuild: CodeBuildClient | undefined;
const codeBuild = () => (sharedBuild ??= new CodeBuildClient({}));
// Build tools colour their output even when it is not a terminal, and some (Vite 8's bundler) ignore NO_COLOR.
// A terminal renders the codes nicely; a pipe or file would only get noise, so strip them there.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const cleanLine = (line: string) => (process.stdout.isTTY ? line : line.replace(ANSI, ''));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getBuild(id: string): Promise<Build> {
  const res = await codeBuild().send(new BatchGetBuildsCommand({ ids: [id] }));
  const build = res.builds?.[0];
  if (!build) throw new Error(`Build ${id} not found.`);
  return build;
}

/** Most recent builds of the project, newest first. */
export async function recentBuilds(project: string, limit: number): Promise<Build[]> {
  const client = codeBuild();
  const list = await client.send(new ListBuildsForProjectCommand({ projectName: project, sortOrder: 'DESCENDING' }));
  const ids = (list.ids ?? []).slice(0, limit);
  if (ids.length === 0) return [];
  const res = await client.send(new BatchGetBuildsCommand({ ids }));
  const byId = new Map((res.builds ?? []).map((b) => [b.id, b]));
  return ids.map((id) => byId.get(id)).filter((b): b is Build => !!b);
}

export const envOf = (build: Build, name: string): string | undefined =>
  build.environment?.environmentVariables?.find((v) => v.name === name)?.value;

export const shortId = (build: Build): string => (build.id ?? '').split(':').pop()!.slice(0, 8);

/** Accepts a full build id, a full uuid, or a unique prefix of one (as shown by `shipzy builds`). */
export async function resolveBuildId(project: string, input: string): Promise<string> {
  if (input.includes(':')) return input;
  const matches = (await recentBuilds(project, 50)).filter((b) => b.id?.split(':').pop()?.startsWith(input));
  if (matches.length > 1) throw new Error(`"${input}" matches ${matches.length} builds; use more characters.`);
  return matches[0]?.id ?? `${project}:${input}`;
}

export function describeFailure(build: Build): string {
  const phase = build.phases?.find((p) => p.phaseStatus === 'FAILED' || p.phaseStatus === 'FAULT' || p.phaseStatus === 'TIMED_OUT');
  if (!phase) return `Build ${build.buildStatus}.`;
  const message = phase.contexts?.[0]?.message;
  return `Build ${build.buildStatus} during ${phase.phaseType}${message ? `: ${message}` : ''}.`;
}

export function duration(build: Build): string {
  if (!build.startTime) return '-';
  const end = build.endTime ?? new Date();
  const seconds = Math.round((end.getTime() - build.startTime.getTime()) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

async function printNew(group: string, stream: string, token?: string): Promise<string | undefined> {
  const client = new CloudWatchLogsClient({});
  for (;;) {
    let res;
    try {
      res = await client.send(
        new GetLogEventsCommand({ logGroupName: group, logStreamName: stream, nextToken: token, startFromHead: true }),
      );
    } catch (err) {
      if ((err as { name?: string }).name === 'ResourceNotFoundException') return token; // stream not created yet
      throw err;
    }
    for (const event of res.events ?? []) {
      const line = cleanLine(event.message ?? '');
      process.stdout.write(line.endsWith('\n') ? line : `${line}\n`);
    }
    const next = res.nextForwardToken;
    if (!next || next === token) return token;
    token = next;
  }
}

/**
 * Prints the build's log. With `follow`, keeps going until the build finishes.
 * Returns the build in its latest state.
 */
export async function streamLogs(buildId: string, follow: boolean): Promise<Build> {
  let token: string | undefined;
  let build = await getBuild(buildId);
  for (;;) {
    const { groupName, streamName } = build.logs ?? {};
    if (groupName && streamName) token = await printNew(groupName, streamName, token);
    if (build.buildComplete || !follow) {
      if (groupName && streamName && build.buildComplete) {
        await sleep(3000); // CloudWatch can trail the build's last lines by a moment
        await printNew(groupName, streamName, token);
      }
      return build;
    }
    await sleep(2000);
    build = await getBuild(buildId);
  }
}
