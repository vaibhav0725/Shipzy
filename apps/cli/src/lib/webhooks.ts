import { StackOutputs } from './aws.js';
import { explainGithubError, removeWebhook } from '@shipzy/core';
import { getSecret } from './secrets.js';

/**
 * Removes the push webhook from a repository. Never throws: cleanup must not block deleting a
 * project, so failures come back as a message telling the user what to do by hand.
 */
export async function removeRepoWebhook(out: StackOutputs, repo: string): Promise<string> {
  if (!out.webhookUrl || !out.githubTokenSecretArn) return `No GitHub support in this stack; nothing to remove from ${repo}.`;
  try {
    const removed = await removeWebhook(await getSecret(out.githubTokenSecretArn), repo, out.webhookUrl);
    return removed ? `Removed the webhook from ${repo}.` : `No webhook found on ${repo}.`;
  } catch (err) {
    return `Could not remove the webhook from ${repo} (${explainGithubError(err, repo).message}); delete it in the repository settings.`;
  }
}
