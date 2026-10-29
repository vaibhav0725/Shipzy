// Every value that becomes a command-line argument is checked here first. The CLI checks again (it is the
// authority); these checks exist so that a bad value never reaches a process, and so a value can never be
// mistaken for an option (nothing accepted here starts with "-").

export class InputError extends Error {}

const PROJECT_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_RE = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const BUILD_RE = /^[A-Za-z0-9][A-Za-z0-9:_.-]{3,199}$/;
const DEPLOYMENT_RE = /^d-\d{8}T\d{6}-[0-9a-f]{6}$/;

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new InputError(`${what} is required.`);
  return value.trim();
}

export const project = (v: unknown): string => {
  const s = str(v, 'The project name');
  if (!PROJECT_RE.test(s)) throw new InputError(`"${s}" is not a valid project name (lowercase letters, digits and dashes).`);
  return s;
};

export const repo = (v: unknown): string => {
  const s = str(v, 'The repository');
  if (!REPO_RE.test(s)) throw new InputError(`"${s}" is not a repository; use owner/name.`);
  return s;
};

export const branch = (v: unknown): string => {
  const s = str(v, 'The branch');
  if (!BRANCH_RE.test(s) || s.includes('..')) throw new InputError(`"${s}" is not a valid branch name.`);
  return s;
};

export const host = (v: unknown): string => {
  const s = str(v, 'The hostname').toLowerCase().replace(/\.$/, '');
  const labels = s.split('.');
  if (
    labels.length < 2 ||
    s.length > 253 ||
    !labels.every((l) => LABEL_RE.test(l)) ||
    /^\d+(\.\d+){3}$/.test(s) ||
    s.endsWith('.cloudfront.net')
  ) {
    throw new InputError(`"${s}" is not a valid hostname.`);
  }
  return s;
};

/** A preview domain: a wildcard such as `*.preview.example.com`. */
export const previewDomain = (v: unknown): string => {
  const s = str(v, 'The preview domain').toLowerCase();
  if (!s.startsWith('*.')) throw new InputError('A preview domain is a wildcard, like *.preview.example.com.');
  return `*.${host(s.slice(2))}`;
};

/** Either a plain hostname or a preview domain (for checking and removing domains). */
export const anyHost = (v: unknown): string => (typeof v === 'string' && v.trim().startsWith('*.') ? previewDomain(v) : host(v));

export const pullRequest = (v: unknown): string => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 10_000_000) throw new InputError('Enter a pull request number.');
  return String(n);
};

// Mirrors packages/core/src/env.ts (the CLI enforces it too; this only gives an answer before a process starts).
const RESERVED_PREFIXES = ['DEPLOY_', 'SOURCE_', 'AWS_', 'CODEBUILD_'];
const RESERVED_NAMES = new Set([
  'INSTALL_COMMAND', 'BUILD_COMMAND', 'SITES_BUCKET', 'BUILDS_BUCKET', 'ENGINE_FUNCTION', 'GITHUB_TOKEN_SECRET',
  'DEFAULT_HOST', 'PATH', 'HOME', 'SHELL', 'USER',
]);

export const envName = (v: unknown): string => {
  const s = str(v, 'The variable name');
  if (!ENV_NAME_RE.test(s)) throw new InputError(`Invalid variable name "${s}": letters, digits and underscores, not starting with a digit.`);
  if (RESERVED_NAMES.has(s) || RESERVED_PREFIXES.some((p) => s.startsWith(p))) {
    throw new InputError(`"${s}" is reserved for the build system; pick another name.`);
  }
  return s;
};

export const buildId = (v: unknown): string => {
  const s = str(v, 'The build id');
  if (!BUILD_RE.test(s)) throw new InputError(`"${s}" is not a build id.`);
  return s;
};

export const deploymentId = (v: unknown): string => {
  const s = str(v, 'The deployment id');
  if (!DEPLOYMENT_RE.test(s)) throw new InputError(`"${s}" is not a deployment id.`);
  return s;
};

/** A directory path from the folder picker or the text box. Must be absolute. */
export const absolutePath = (v: unknown): string => {
  const s = str(v, 'The folder');
  if (!s.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(s)) throw new InputError('Use a full path to the folder.');
  if (s.includes('\0')) throw new InputError('Invalid path.');
  return s;
};

/** Free text for --install-command / --build-command. Passed as `--flag=value`, so it cannot become an option. */
export const command = (v: unknown, what: string): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const s = str(v, what);
  if (s.length > 500 || /[\0\r\n]/.test(s)) throw new InputError(`${what} must be a single line of at most 500 characters.`);
  return s;
};

export const flag = (v: unknown): boolean => v === true;

export const keep = (v: unknown): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new InputError('Keep must be a whole number from 1 to 1000.');
  return String(n);
};
