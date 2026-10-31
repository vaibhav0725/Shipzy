// List prices (USD) behind `shipzy cost`. They are estimates: CloudFront is priced per region and per volume tier,
// and the free allowances are shared by the whole AWS account, so the real bill can be lower. The figures are the
// US/Europe rates, which are also the most common.
export const PRICES = {
  /** CloudFront data transfer out, first 10 TB tier, per GB */
  cloudfrontGb: 0.085,
  /** CloudFront HTTPS requests, per million */
  cloudfrontMillionRequests: 1.0,
  /** CloudFront Function invocations (the router), per million */
  functionMillionInvocations: 0.1,
  /** CloudFront KeyValueStore reads (the routing table), per million */
  kvsMillionReads: 0.03,
  /** S3 Standard, per GB-month */
  s3GbMonth: 0.023,
  /** CodeBuild general1.small, per build minute */
  codeBuildMinute: 0.005,
  /** Secrets Manager, per secret per month */
  secretMonth: 0.4,
} as const;

/** Always-free monthly allowances. */
export const FREE = {
  cloudfrontGb: 1024,
  cloudfrontRequests: 10_000_000,
  functionInvocations: 2_000_000,
  codeBuildMinutes: 100,
} as const;

export interface Usage {
  /** viewer requests to all sites this month so far */
  requests: number;
  /** bytes sent to viewers this month so far */
  bytesOut: number;
  /** average bytes stored in the sites and builds buckets */
  bytesStored: number;
  /** CodeBuild minutes this month so far */
  buildMinutes: number;
  /** secrets kept by the stack (webhook secret, GitHub token) */
  secrets: number;
}

export interface Line {
  key: 'cloudfront' | 'router' | 'storage' | 'builds' | 'secrets';
  label: string;
  /** what was used, in words */
  usage: string;
  /** cost before free allowances */
  gross: number;
  /** cost after free allowances */
  net: number;
}

const GB = 1024 ** 3;
const over = (used: number, free: number) => Math.max(0, used - free);

export function priceUsage(u: Usage): Line[] {
  const gb = u.bytesOut / GB;
  const cloudfrontGross = gb * PRICES.cloudfrontGb + (u.requests / 1e6) * PRICES.cloudfrontMillionRequests;
  const cloudfrontNet = over(gb, FREE.cloudfrontGb) * PRICES.cloudfrontGb + (over(u.requests, FREE.cloudfrontRequests) / 1e6) * PRICES.cloudfrontMillionRequests;
  const routerGross = (u.requests / 1e6) * (PRICES.functionMillionInvocations + PRICES.kvsMillionReads);
  const routerNet =
    (over(u.requests, FREE.functionInvocations) / 1e6) * PRICES.functionMillionInvocations + (u.requests / 1e6) * PRICES.kvsMillionReads;
  const storedGb = u.bytesStored / GB;
  return [
    { key: 'cloudfront', label: 'CloudFront traffic', usage: `${gb.toFixed(2)} GB, ${u.requests.toLocaleString('en-US')} requests`, gross: cloudfrontGross, net: cloudfrontNet },
    { key: 'router', label: 'Router', usage: `${u.requests.toLocaleString('en-US')} lookups`, gross: routerGross, net: routerNet },
    { key: 'storage', label: 'S3 storage', usage: `${storedGb.toFixed(2)} GB`, gross: storedGb * PRICES.s3GbMonth, net: storedGb * PRICES.s3GbMonth },
    {
      key: 'builds',
      label: 'CodeBuild',
      usage: `${Math.round(u.buildMinutes)} min`,
      gross: u.buildMinutes * PRICES.codeBuildMinute,
      net: over(u.buildMinutes, FREE.codeBuildMinutes) * PRICES.codeBuildMinute,
    },
    { key: 'secrets', label: 'Secrets Manager', usage: `${u.secrets} secret${u.secrets === 1 ? '' : 's'}`, gross: u.secrets * PRICES.secretMonth, net: u.secrets * PRICES.secretMonth },
  ];
}

/** Traffic-driven figures grow with the month; storage and secrets are a flat monthly rate already. */
export function projectUsage(u: Usage, dayOfMonth: number, daysInMonth: number): Usage {
  const factor = daysInMonth / Math.max(1, dayOfMonth);
  return { ...u, requests: u.requests * factor, bytesOut: u.bytesOut * factor, buildMinutes: u.buildMinutes * factor };
}
