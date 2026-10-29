import { S3Client } from '@aws-sdk/client-s3';

// One client per process: a new client means a new connection (about a second of TLS and credential lookup each time).
let client: S3Client | undefined;
export const s3 = () => (client ??= new S3Client({}));
