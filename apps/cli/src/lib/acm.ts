import { createHash } from 'node:crypto';
import {
  ACMClient,
  CertificateStatus,
  DeleteCertificateCommand,
  DescribeCertificateCommand,
  ListCertificatesCommand,
  RequestCertificateCommand,
} from '@aws-sdk/client-acm';

// CloudFront only accepts certificates from us-east-1, whatever region the stack lives in.
let shared: ACMClient | undefined;
const client = () => (shared ??= new ACMClient({ region: 'us-east-1' }));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ValidationRecord {
  name: string;
  type: string;
  value: string;
}

export interface CertInfo {
  arn: string;
  status: string;
  validation?: ValidationRecord;
  /** why issuing failed, when it did */
  failureReason?: string;
}

/** An existing certificate for exactly this name that is issued or waiting to be validated. */
export async function findCertificate(host: string): Promise<string | undefined> {
  let token: string | undefined;
  do {
    const page = await client().send(
      new ListCertificatesCommand({
        CertificateStatuses: [CertificateStatus.PENDING_VALIDATION, CertificateStatus.ISSUED],
        NextToken: token,
      }),
    );
    const hit = page.CertificateSummaryList?.find((c) => c.DomainName?.toLowerCase() === host.toLowerCase());
    if (hit?.CertificateArn) return hit.CertificateArn;
    token = page.NextToken;
  } while (token);
  return undefined;
}

export async function requestCertificate(host: string): Promise<string> {
  const res = await client().send(
    new RequestCertificateCommand({
      DomainName: host,
      ValidationMethod: 'DNS',
      // Repeating the call within an hour returns the same certificate instead of creating a second one.
      IdempotencyToken: createHash('sha1').update(host).digest('hex').slice(0, 32),
      Tags: [{ Key: 'deployer', Value: 'domain' }],
    }),
  );
  return res.CertificateArn!;
}

export async function describeCertificate(arn: string): Promise<CertInfo> {
  const { Certificate: cert } = await client().send(new DescribeCertificateCommand({ CertificateArn: arn }));
  const record = cert?.DomainValidationOptions?.[0]?.ResourceRecord;
  return {
    arn,
    status: cert?.Status ?? 'UNKNOWN',
    validation: record?.Name && record.Type && record.Value ? { name: record.Name, type: record.Type, value: record.Value } : undefined,
    failureReason: cert?.FailureReason,
  };
}

/** The validation record appears a few seconds after the request. */
export async function waitForValidationRecord(arn: string, timeoutMs = 120_000): Promise<CertInfo> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const info = await describeCertificate(arn);
    if (info.validation || info.status === 'ISSUED') return info;
    if (Date.now() > deadline) throw new Error('ACM did not return a validation record in time; try again in a minute.');
    await sleep(4000);
  }
}

export async function waitUntilIssued(arn: string, timeoutMs: number, onWait: (seconds: number) => void): Promise<boolean> {
  const started = Date.now();
  for (;;) {
    const info = await describeCertificate(arn);
    if (info.status === 'ISSUED') return true;
    if (info.status === 'FAILED' || info.status === 'VALIDATION_TIMED_OUT') {
      throw new Error(`The certificate could not be issued (${info.failureReason ?? info.status}). Remove the domain and add it again.`);
    }
    if (Date.now() - started > timeoutMs) return false;
    onWait(Math.round((Date.now() - started) / 1000));
    await sleep(15_000);
  }
}

/** A certificate can only be deleted once nothing uses it; CloudFront lets go a little after its stack is gone. */
export async function deleteCertificate(arn: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await client().send(new DeleteCertificateCommand({ CertificateArn: arn }));
      return;
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'ResourceNotFoundException') return;
      if (name !== 'ResourceInUseException' || attempt >= 40) throw err;
      await sleep(15_000);
    }
  }
}
