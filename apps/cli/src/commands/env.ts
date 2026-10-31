import { ui } from '../lib/ui.js';
import * as fs from 'node:fs';
import {
  assertEnvName,
  assertEnvValue,
  assertProjectName,
  EnvScope,
  envParamPath,
  readManifest,
  updateManifest,
} from '@deployer/core';
import { getOutputs, GlobalOptions } from '../lib/aws.js';
import { parseDotenv } from '../lib/dotenv.js';
import { table } from '../lib/format.js';
import { promptHidden } from '../lib/prompt.js';
import { deleteParams, putParam } from '../lib/ssm.js';

const scopeOf = (preview?: boolean): EnvScope => (preview ? 'preview' : 'production');

const APPLY_HINT = (project: string) =>
  `Applies to the next build, not to what is live now. Rebuild with: shipzy deploy <dir> --remote  (or: shipzy github deploy -p ${project})`;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

export interface EnvSetOptions {
  project: string;
  preview?: boolean;
}

/** `env set NAME value`, `env set NAME=value`, or `env set NAME` (value read from stdin, or typed hidden). */
export async function envSet(nameArg: string, valueArg: string | undefined, opts: EnvSetOptions, global: GlobalOptions): Promise<void> {
  assertProjectName(opts.project);
  let name = nameArg;
  let value = valueArg;
  if (value === undefined && nameArg.includes('=')) {
    const at = nameArg.indexOf('=');
    name = nameArg.slice(0, at);
    value = nameArg.slice(at + 1);
  }
  assertEnvName(name);
  if (value === undefined) {
    value = process.stdin.isTTY ? await promptHidden(`Value for ${name} (input hidden): `) : await readStdin();
  }
  assertEnvValue(name, value);

  const out = await getOutputs(global.stackName);
  const scope = scopeOf(opts.preview);
  // Value first, then the name: the history file never lists a variable that does not exist.
  await putParam(envParamPath(global.stackName, opts.project, scope, name), value);
  await updateManifest(out.bucket, opts.project, (m) => {
    m.env ??= { production: [], preview: [] };
    if (!m.env[scope].includes(name)) m.env[scope].push(name);
  });
  console.log(ui.ok(`Set ${ui.name(name)} for ${scope} builds of ${opts.project}.`));
  console.log(APPLY_HINT(opts.project));
}

export async function envImport(file: string, opts: EnvSetOptions, global: GlobalOptions): Promise<void> {
  assertProjectName(opts.project);
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  const { vars, errors } = parseDotenv(fs.readFileSync(file, 'utf8'));

  // Validate everything before writing anything.
  for (const [name, value] of Object.entries(vars)) {
    try {
      assertEnvName(name);
      assertEnvValue(name, value);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (errors.length > 0) throw new Error(`Nothing imported; fix these first:\n  ${errors.join('\n  ')}`);
  const names = Object.keys(vars);
  if (names.length === 0) throw new Error(`No variables found in ${file}.`);

  const out = await getOutputs(global.stackName);
  const scope = scopeOf(opts.preview);
  for (const name of names) await putParam(envParamPath(global.stackName, opts.project, scope, name), vars[name]!);
  await updateManifest(out.bucket, opts.project, (m) => {
    m.env ??= { production: [], preview: [] };
    for (const name of names) if (!m.env[scope].includes(name)) m.env[scope].push(name);
  });
  console.log(`Imported ${names.length} variable${names.length === 1 ? '' : 's'} for ${scope} builds of ${opts.project}: ${names.join(', ')}`);
  console.log(APPLY_HINT(opts.project));
}

export async function envList(opts: { project: string; json?: boolean }, global: GlobalOptions): Promise<void> {
  assertProjectName(opts.project);
  const out = await getOutputs(global.stackName);
  const env = (await readManifest(out.bucket, opts.project)).env ?? { production: [], preview: [] };
  const names = [...new Set([...env.production, ...env.preview])].sort();

  const rows = names.map((name) => ({
    name,
    production: env.production.includes(name),
    preview: env.preview.includes(name),
  }));
  if (opts.json) return console.log(JSON.stringify(rows, null, 2));
  if (rows.length === 0) return console.log(`No environment variables for "${opts.project}". Add one with: shipzy env set -p ${opts.project} NAME value`);

  console.log(
    table(
      ['NAME', 'PRODUCTION', 'PREVIEW OVERRIDE'],
      rows.map((r) => [ui.name(r.name), r.production ? ui.green('yes') : ui.dim('-'), r.preview ? ui.green('yes') : ui.dim('-')]),
    ),
  );
  console.log(ui.dim('\nValues are never shown. Preview builds use the production value unless a preview override exists.'));
}

export async function envRemove(name: string, opts: EnvSetOptions, global: GlobalOptions): Promise<void> {
  assertProjectName(opts.project);
  const out = await getOutputs(global.stackName);
  const scope = scopeOf(opts.preview);
  const current = (await readManifest(out.bucket, opts.project)).env?.[scope] ?? [];
  if (!current.includes(name)) {
    throw new Error(`"${name}" is not set for ${scope} builds of ${opts.project}. See: shipzy env ls -p ${opts.project}`);
  }
  await updateManifest(out.bucket, opts.project, (m) => {
    if (m.env) m.env[scope] = m.env[scope].filter((n) => n !== name);
  });
  await deleteParams([envParamPath(global.stackName, opts.project, scope, name)]);
  console.log(`Removed ${name} from ${scope} builds of ${opts.project}.`);
  console.log(APPLY_HINT(opts.project));
}
