import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import type { BuildEnvVar } from './env.js';

export type BuildSource =
  | { type: 's3'; key: string }
  // `public`: the repository can be read without a token, so the build does not send one
  | { type: 'github'; repo: string; sha: string; public?: boolean };

export interface BuildRequest {
  project: string;
  id: string;
  /** hosts to make live; when absent the engine decides (custom domains, else the CloudFront URL) */
  hosts?: string[];
  keep?: number;
  source: BuildSource;
  installCommand?: string;
  buildCommand?: string;
  /** the project's own build-time variables, injected from SSM Parameter Store */
  env?: BuildEnvVar[];
  /** set when the build is a preview of a pull request */
  preview?: { pr: number };
}

export interface BuildEnvironmentVariable {
  name: string;
  value: string;
  type: 'PLAINTEXT' | 'PARAMETER_STORE';
}

/**
 * The contract between whoever starts a build (CLI, webhook) and the buildspec in the stack:
 * everything a build needs arrives as environment variables.
 */
export function buildEnvironment(req: BuildRequest): BuildEnvironmentVariable[] {
  const vars: [string, string | undefined][] = [
    ['DEPLOY_PROJECT', req.project],
    ['DEPLOY_ID', req.id],
    ['DEPLOY_HOSTS', req.hosts?.join(',')],
    ['DEPLOY_KEEP', req.keep === undefined ? undefined : String(req.keep)],
    ['SOURCE_TYPE', req.source.type],
    ['SOURCE_S3_KEY', req.source.type === 's3' ? req.source.key : undefined],
    ['SOURCE_REPO', req.source.type === 'github' ? req.source.repo : undefined],
    ['SOURCE_REF', req.source.type === 'github' ? req.source.sha : undefined],
    ['SOURCE_PUBLIC', req.source.type === 'github' && req.source.public ? '1' : undefined],
    ['INSTALL_COMMAND', req.installCommand],
    ['BUILD_COMMAND', req.buildCommand],
    ['DEPLOY_PREVIEW_PR', req.preview === undefined ? undefined : String(req.preview.pr)],
  ];
  const plain = vars
    .filter((v): v is [string, string] => !!v[1])
    .map(([name, value]): BuildEnvironmentVariable => ({ name, value, type: 'PLAINTEXT' }));
  // CodeBuild resolves PARAMETER_STORE values itself, so the secret never appears in the build's metadata.
  const fromSsm = (req.env ?? []).map(
    ({ name, path }): BuildEnvironmentVariable => ({ name, value: path, type: 'PARAMETER_STORE' }),
  );
  return [...plain, ...fromSsm];
}

/** Starts a build and returns its id. */
export async function startBuild(codeBuildProject: string, req: BuildRequest): Promise<string> {
  const res = await new CodeBuildClient({}).send(
    new StartBuildCommand({ projectName: codeBuildProject, environmentVariablesOverride: buildEnvironment(req) }),
  );
  return res.build!.id!;
}
