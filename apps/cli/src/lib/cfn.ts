import { spinner } from './ui.js';
import {
  type Capability,
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStackEventsCommand,
  type Stack,
  UpdateStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackDeleteComplete,
  waitUntilStackUpdateComplete,
} from '@aws-sdk/client-cloudformation';
import { cloudFormation, errorMessage, findStack } from './aws.js';

const MAX_WAIT_SECONDS = 1800;

/** Runs a CloudFormation waiter; on failure, explains the resource that actually broke. */
export async function waitOrExplain(cfn: CloudFormationClient, stackName: string, wait: () => Promise<unknown>): Promise<void> {
  try {
    await wait();
  } catch (err) {
    const events = await cfn.send(new DescribeStackEventsCommand({ StackName: stackName })).catch(() => undefined);
    // The root cause is a resource that failed on its own; the rest are "cancelled" because it failed.
    const failed = (events?.StackEvents ?? []).filter((e) => e.ResourceStatus?.endsWith('FAILED') && e.ResourceStatusReason);
    const rootCauses = failed.filter((e) => !/cancel/i.test(e.ResourceStatusReason ?? ''));
    const reasons = (rootCauses.length ? rootCauses : failed).slice(0, 5);
    if (reasons.some((e) => /CNAMEAlreadyExists/.test(e.ResourceStatusReason ?? ''))) {
      throw new Error(
        'That hostname is already attached to another CloudFront distribution (another stack, or something outside this tool). ' +
          'Remove it from that distribution first; a hostname can belong to only one.',
      );
    }
    const lines = reasons.map((e) => `  ${e.LogicalResourceId}: ${e.ResourceStatusReason}`);
    throw new Error(
      lines.length ? `Stack operation failed:\n${lines.join('\n')}` : `Stack operation failed (${errorMessage(err).slice(0, 200)}).`,
    );
  }
}

export interface DeployStackOptions {
  name: string;
  templateBody: string;
  parameters: Record<string, string>;
  tags?: Record<string, string>;
  /** needed when the template creates named IAM roles */
  capabilities?: Capability[];
  /** shown while waiting */
  label?: string;
}

/** Creates the stack, or updates it if it exists, waits for it, and returns its outputs. */
export async function deployStack(opts: DeployStackOptions): Promise<{ stack: Stack; outputs: Record<string, string>; changed: boolean }> {
  const cfn = cloudFormation();
  let existing = await findStack(opts.name);
  if (existing?.StackStatus === 'ROLLBACK_COMPLETE') {
    await cfn.send(new DeleteStackCommand({ StackName: opts.name }));
    await waitUntilStackDeleteComplete({ client: cfn, maxWaitTime: MAX_WAIT_SECONDS }, { StackName: opts.name });
    existing = undefined;
  }

  const common = {
    StackName: opts.name,
    TemplateBody: opts.templateBody,
    Parameters: Object.entries(opts.parameters).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
    Tags: Object.entries(opts.tags ?? {}).map(([Key, Value]) => ({ Key, Value })),
    ...(opts.capabilities ? { Capabilities: opts.capabilities } : {}),
  };
  let changed = true;
  if (!existing) {
    await cfn.send(new CreateStackCommand(common));
    const stop = spinner(opts.label ?? `Creating ${opts.name}`);
    try {
      await waitOrExplain(cfn, opts.name, () =>
        waitUntilStackCreateComplete({ client: cfn, maxWaitTime: MAX_WAIT_SECONDS }, { StackName: opts.name }),
      );
    } finally {
      stop();
    }
  } else {
    let stop = () => {};
    try {
      await cfn.send(new UpdateStackCommand(common));
      stop = spinner(opts.label ?? `Updating ${opts.name}`);
      await waitOrExplain(cfn, opts.name, () =>
        waitUntilStackUpdateComplete({ client: cfn, maxWaitTime: MAX_WAIT_SECONDS }, { StackName: opts.name }),
      );
    } catch (err) {
      if (!errorMessage(err).includes('No updates are to be performed')) throw err;
      changed = false;
    } finally {
      stop();
    }
  }

  const stack = (await findStack(opts.name))!;
  return { stack, outputs: outputsOf(stack), changed };
}

export async function removeStack(name: string): Promise<void> {
  const cfn = cloudFormation();
  await cfn.send(new DeleteStackCommand({ StackName: name }));
  const stop = spinner(`Deleting ${name}`);
  try {
    await waitUntilStackDeleteComplete({ client: cfn, maxWaitTime: MAX_WAIT_SECONDS }, { StackName: name });
  } finally {
    stop();
  }
}

export function outputsOf(stack: Stack): Record<string, string> {
  return Object.fromEntries((stack.Outputs ?? []).flatMap((o) => (o.OutputKey && o.OutputValue ? [[o.OutputKey, o.OutputValue]] : [])));
}

export function paramsOf(stack: Stack): Record<string, string> {
  return Object.fromEntries(
    (stack.Parameters ?? []).flatMap((p) => (p.ParameterKey && p.ParameterValue !== undefined ? [[p.ParameterKey, p.ParameterValue]] : [])),
  );
}
