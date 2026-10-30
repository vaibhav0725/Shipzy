import * as path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // A self-contained server (`.next/standalone`) that `deployer dashboard` ships and runs.
  output: 'standalone',
  // The workspace root, so the standalone build keeps a predictable layout inside the monorepo.
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  // Local tool: no gzip, so the live job logs (server-sent events) are never held back by a buffer.
  compress: false,
  poweredByHeader: false,
  reactStrictMode: true,
  // Do not let `next dev` write an AGENTS.md into the project.
  agentRules: false,
};

export default config;
