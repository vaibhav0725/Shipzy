// Facts the whole site shares. Change them here.
export const site = {
  name: 'shipzy',
  tagline: 'Your own Vercel, in your own AWS account.',
  description:
    'shipzy deploys React and Next.js sites to S3 and CloudFront in your own AWS account: instant rollbacks, preview URLs, custom domains and GitHub push deploys. Nothing runs on our servers.',
  /** the address the site is served at (used for links in the sitemap and social cards) */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://shipzy.quantav.xyz',
  /** the public repository (an empty value hides the links) */
  repoUrl: process.env.NEXT_PUBLIC_REPO_URL ?? 'https://github.com/vaibhav0725/Shipzy',
  npmUrl: 'https://www.npmjs.com/package/shipzy',
  install: 'npm install -g shipzy@beta',
  license: 'Apache-2.0',
};
