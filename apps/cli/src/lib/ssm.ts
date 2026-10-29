import {
  DeleteParametersCommand,
  GetParametersByPathCommand,
  GetParametersCommand,
  PutParameterCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';

let shared: SSMClient | undefined;
const client = () => (shared ??= new SSMClient({}));

/** Stores a value encrypted (SecureString, AWS-managed key: free). */
export async function putParam(path: string, value: string): Promise<void> {
  await client().send(new PutParameterCommand({ Name: path, Value: value, Type: 'SecureString', Overwrite: true }));
}

export async function deleteParams(paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 10) {
    await client().send(new DeleteParametersCommand({ Names: paths.slice(i, i + 10) }));
  }
}

/** Every parameter name under a prefix. Values are never read. */
export async function listParamNames(prefix: string): Promise<string[]> {
  const names: string[] = [];
  let token: string | undefined;
  do {
    const page = await client().send(
      new GetParametersByPathCommand({ Path: prefix, Recursive: true, WithDecryption: false, NextToken: token }),
    );
    for (const p of page.Parameters ?? []) if (p.Name) names.push(p.Name);
    token = page.NextToken;
  } while (token);
  return names;
}

/** Deletes everything under a prefix; returns how many parameters went. */
export async function deleteParamsUnder(prefix: string): Promise<number> {
  const names = await listParamNames(prefix);
  await deleteParams(names);
  return names.length;
}

/** Which of these parameters do not exist? */
export async function missingParams(paths: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (let i = 0; i < paths.length; i += 10) {
    const res = await client().send(new GetParametersCommand({ Names: paths.slice(i, i + 10), WithDecryption: false }));
    missing.push(...(res.InvalidParameters ?? []));
  }
  return missing;
}
