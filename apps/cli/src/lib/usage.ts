import { CloudWatchClient, GetMetricDataCommand, type MetricDataQuery } from '@aws-sdk/client-cloudwatch';
import { BatchGetBuildsCommand, CodeBuildClient, ListBuildsForProjectCommand } from '@aws-sdk/client-codebuild';
import type { Usage } from './pricing.js';

// CloudFront publishes its metrics in us-east-1, whatever region the stack is in; S3 publishes in the bucket's region.
const cloudfrontMetrics = () => new CloudWatchClient({ region: 'us-east-1' });
const regionalMetrics = () => new CloudWatchClient({});

const DAY = 86400;

/** Sum of every datapoint of a CloudWatch query result. */
const total = (values: number[] | undefined) => (values ?? []).reduce((a, b) => a + b, 0);

async function fetchMetrics(client: CloudWatchClient, queries: MetricDataQuery[], start: Date, end: Date): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  // GetMetricData takes at most 500 queries per call.
  for (let i = 0; i < queries.length; i += 400) {
    let token: string | undefined;
    do {
      const res = await client.send(new GetMetricDataCommand({ MetricDataQueries: queries.slice(i, i + 400), StartTime: start, EndTime: end, NextToken: token }));
      for (const r of res.MetricDataResults ?? []) out.set(r.Id!, [...(out.get(r.Id!) ?? []), ...(r.Values ?? [])]);
      token = res.NextToken;
    } while (token);
  }
  return out;
}

/** Requests and bytes served by these distributions between `start` and now. */
export async function cloudfrontTraffic(distributionIds: string[], start: Date, end: Date): Promise<{ requests: number; bytesOut: number }> {
  if (distributionIds.length === 0) return { requests: 0, bytesOut: 0 };
  const queries: MetricDataQuery[] = distributionIds.flatMap((id, i) =>
    (['Requests', 'BytesDownloaded'] as const).map((metric) => ({
      Id: `${metric === 'Requests' ? 'r' : 'b'}${i}`,
      ReturnData: true,
      MetricStat: {
        Metric: { Namespace: 'AWS/CloudFront', MetricName: metric, Dimensions: [{ Name: 'DistributionId', Value: id }, { Name: 'Region', Value: 'Global' }] },
        Period: DAY,
        Stat: 'Sum',
      },
    })),
  );
  const res = await fetchMetrics(cloudfrontMetrics(), queries, start, end);
  let requests = 0;
  let bytesOut = 0;
  for (const [id, values] of res) {
    if (id.startsWith('r')) requests += total(values);
    else bytesOut += total(values);
  }
  return { requests, bytesOut };
}

/** Average size of the buckets over the last two days (S3 reports storage once a day, so "now" has no datapoint yet). */
export async function bucketBytes(buckets: string[]): Promise<number> {
  if (buckets.length === 0) return 0;
  const end = new Date();
  const start = new Date(end.getTime() - 3 * DAY * 1000);
  const queries: MetricDataQuery[] = buckets.map((bucket, i) => ({
    Id: `s${i}`,
    ReturnData: true,
    MetricStat: {
      Metric: { Namespace: 'AWS/S3', MetricName: 'BucketSizeBytes', Dimensions: [{ Name: 'BucketName', Value: bucket }, { Name: 'StorageType', Value: 'StandardStorage' }] },
      Period: DAY,
      Stat: 'Average',
    },
  }));
  const res = await fetchMetrics(regionalMetrics(), queries, start, end);
  let sum = 0;
  for (const values of res.values()) {
    // CloudWatch returns newest first by default.
    if (values.length > 0) sum += values[0]!;
  }
  return sum;
}

/** Build minutes since `start`; each started minute is billed. */
export async function buildMinutesSince(project: string | undefined, start: Date): Promise<number> {
  if (!project) return 0;
  const client = new CodeBuildClient({});
  const ids: string[] = [];
  let token: string | undefined;
  // Newest first, so stop paging once a whole page is older than the month; 3 pages (300 builds) is plenty.
  for (let page = 0; page < 3; page++) {
    const res = await client.send(new ListBuildsForProjectCommand({ projectName: project, sortOrder: 'DESCENDING', nextToken: token }));
    ids.push(...(res.ids ?? []));
    token = res.nextToken;
    if (!token) break;
  }
  let minutes = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const res = await client.send(new BatchGetBuildsCommand({ ids: ids.slice(i, i + 100) }));
    for (const b of res.builds ?? []) {
      if (!b.startTime || b.startTime < start) continue;
      const end = b.endTime ?? new Date();
      minutes += Math.max(1, Math.ceil((end.getTime() - b.startTime.getTime()) / 60000));
    }
  }
  return minutes;
}

export type { Usage };
