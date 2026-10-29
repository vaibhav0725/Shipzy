/** Where a build-time environment variable applies. */
export type EnvScope = 'production' | 'preview';

/** The names of a project's variables, kept in its history file. The values live in SSM Parameter Store. */
export interface ManifestEnv {
  production: string[];
  preview: string[];
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

// Names the build itself relies on: a project variable must never replace them.
const RESERVED_PREFIXES = ['DEPLOY_', 'SOURCE_', 'AWS_', 'CODEBUILD_'];
const RESERVED_NAMES = new Set([
  'INSTALL_COMMAND',
  'BUILD_COMMAND',
  'SITES_BUCKET',
  'BUILDS_BUCKET',
  'ENGINE_FUNCTION',
  'GITHUB_TOKEN_SECRET',
  'DEFAULT_HOST',
  'PATH',
  'HOME',
  'SHELL',
  'USER',
]);

export const MAX_ENV_VALUE_BYTES = 4096;

export function assertEnvName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(`Invalid variable name "${name}": use letters, digits and underscores, not starting with a digit.`);
  }
  if (RESERVED_NAMES.has(name) || RESERVED_PREFIXES.some((p) => name.startsWith(p))) {
    throw new Error(`"${name}" is reserved for the build system; pick another name.`);
  }
}

export function assertEnvValue(name: string, value: string): void {
  if (value === '') throw new Error(`${name}: empty values are not supported (remove the variable instead).`);
  if (Buffer.byteLength(value, 'utf8') > MAX_ENV_VALUE_BYTES) {
    throw new Error(`${name}: the value is larger than ${MAX_ENV_VALUE_BYTES} bytes.`);
  }
}

export const envParamPrefix = (stackName: string, project?: string): string =>
  project ? `/deployer/${stackName}/${project}/` : `/deployer/${stackName}/`;

export const envParamPath = (stackName: string, project: string, scope: EnvScope, name: string): string =>
  `${envParamPrefix(stackName, project)}${scope}/${name}`;

export interface BuildEnvVar {
  name: string;
  /** SSM parameter holding the value */
  path: string;
}

/**
 * The variables a build of this scope receives. Production builds get the production set; preview builds get
 * the production set with any preview values laid over it, so a preview only needs to list what differs.
 */
export function buildEnvVars(
  stackName: string,
  project: string,
  env: ManifestEnv | undefined,
  scope: EnvScope,
): BuildEnvVar[] {
  const vars = new Map<string, string>();
  for (const name of env?.production ?? []) vars.set(name, envParamPath(stackName, project, 'production', name));
  if (scope === 'preview') {
    for (const name of env?.preview ?? []) vars.set(name, envParamPath(stackName, project, 'preview', name));
  }
  return [...vars].map(([name, path]) => ({ name, path }));
}
