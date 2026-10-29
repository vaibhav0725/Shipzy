import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

const client = () => new SecretsManagerClient({});

export async function getSecret(arn: string): Promise<string> {
  const res = await client().send(new GetSecretValueCommand({ SecretId: arn }));
  if (!res.SecretString) throw new Error('Secret has no value.');
  return res.SecretString;
}

export async function putSecret(arn: string, value: string): Promise<void> {
  await client().send(new PutSecretValueCommand({ SecretId: arn, SecretString: value }));
}
