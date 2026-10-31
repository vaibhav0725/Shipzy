import { BuildEnvVar, buildEnvVars, EnvScope, readManifest } from '@deployer/core';
import { missingParams } from './ssm.js';

/**
 * The project's build-time variables for a build of this scope. Checks first that every one still exists in
 * SSM, because CodeBuild's own failure for a missing parameter is hard to read.
 */
export async function projectBuildEnv(
  bucket: string,
  stackName: string,
  project: string,
  scope: EnvScope = 'production',
): Promise<BuildEnvVar[]> {
  const { env } = await readManifest(bucket, project);
  const vars = buildEnvVars(stackName, project, env, scope);
  if (vars.length === 0) return vars;

  const missing = new Set(await missingParams(vars.map((v) => v.path)));
  const names = vars.filter((v) => missing.has(v.path)).map((v) => v.name);
  if (names.length > 0) {
    throw new Error(
      `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} listed for "${project}" but missing from the parameter store. ` +
        `Set again with: shipzy env set -p ${project} <NAME> <value>   (or remove: shipzy env rm -p ${project} <NAME>)`,
    );
  }
  return vars;
}
