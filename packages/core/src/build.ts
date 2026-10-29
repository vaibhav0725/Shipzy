import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';

export type BuildSource = { type: 's3'; key: string } | { type: 'github'; repo: string; sha: string };

export interface BuildRequest {
  project: string;
  id: string;
  host?: string;
  keep?: number;
  source: BuildSource;
  installCommand?: string;
  buildCommand?: string;
}

/**
 * The contract between whoever starts a build (CLI, webhook) and the buildspec in the stack:
 * everything a build needs arrives as environment variables.
 */
export function buildEnvironment(req: BuildRequest): { name: string; value: string; type: 'PLAINTEXT' }[] {
  const vars: [string, string | undefined][] = [
    ['DEPLOY_PROJECT', req.project],
    ['DEPLOY_ID', req.id],
    ['DEPLOY_HOST', req.host],
    ['DEPLOY_KEEP', req.keep === undefined ? undefined : String(req.keep)],
    ['SOURCE_TYPE', req.source.type],
    ['SOURCE_S3_KEY', req.source.type === 's3' ? req.source.key : undefined],
    ['SOURCE_REPO', req.source.type === 'github' ? req.source.repo : undefined],
    ['SOURCE_REF', req.source.type === 'github' ? req.source.sha : undefined],
    ['INSTALL_COMMAND', req.installCommand],
    ['BUILD_COMMAND', req.buildCommand],
  ];
  return vars
    .filter((v): v is [string, string] => !!v[1])
    .map(([name, value]) => ({ name, value, type: 'PLAINTEXT' as const }));
}

/** Starts a build and returns its id. */
export async function startBuild(codeBuildProject: string, req: BuildRequest): Promise<string> {
  const res = await new CodeBuildClient({}).send(
    new StartBuildCommand({ projectName: codeBuildProject, environmentVariablesOverride: buildEnvironment(req) }),
  );
  return res.build!.id!;
}
