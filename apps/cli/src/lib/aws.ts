import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { S3Client } from '@aws-sdk/client-s3';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

export interface GlobalOptions {
  profile?: string;
  region?: string;
  stackName: string;
}

export interface StackOutputs {
  bucket: string;
  distributionId: string;
  domain: string;
  kvsArn: string;
}

const OK_STATUSES = new Set(['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE']);

// The SDK's default credential chain honours these, so profiles/SSO/env keys all work.
export function configureEnv(opts: GlobalOptions): void {
  if (opts.profile) process.env.AWS_PROFILE = opts.profile;
  process.env.AWS_REGION =
    opts.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
}

export const cloudFormation = () => new CloudFormationClient({});
export const s3 = () => new S3Client({});

export async function whoAmI(): Promise<{ account: string; arn: string }> {
  try {
    const id = await new STSClient({}).send(new GetCallerIdentityCommand({}));
    return { account: id.Account ?? '', arn: id.Arn ?? '' };
  } catch (err) {
    throw new Error(
      `Could not load AWS credentials (${errorMessage(err)}). ` +
        'Set AWS_PROFILE / use --profile, or run `aws sso login`.',
    );
  }
}

export async function findStack(stackName: string) {
  try {
    const res = await cloudFormation().send(new DescribeStacksCommand({ StackName: stackName }));
    return res.Stacks?.[0];
  } catch (err) {
    if (errorMessage(err).includes('does not exist')) return undefined;
    throw err;
  }
}

export function readOutputs(stack: { Outputs?: { OutputKey?: string; OutputValue?: string }[] }): StackOutputs {
  const get = (key: string): string => {
    const value = stack.Outputs?.find((o) => o.OutputKey === key)?.OutputValue;
    if (!value) throw new Error(`Stack is missing output ${key}; try \`deployer init\` again.`);
    return value;
  };
  return {
    bucket: get('BucketName'),
    distributionId: get('DistributionId'),
    domain: get('DistributionDomain'),
    kvsArn: get('KeyValueStoreArn'),
  };
}

export async function getOutputs(stackName: string): Promise<StackOutputs> {
  const stack = await findStack(stackName);
  if (!stack) throw new Error(`Stack "${stackName}" not found. Run \`deployer init\` first.`);
  if (!OK_STATUSES.has(stack.StackStatus ?? '')) {
    throw new Error(`Stack "${stackName}" is in state ${stack.StackStatus}; wait for it or fix it first.`);
  }
  return readOutputs(stack);
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}
