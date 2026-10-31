# shipzy

Deploy React and static-export Next.js sites to **your own AWS account** (S3 + CloudFront). Nothing runs on shipzy servers, and there is no shipzy account: it uses your normal AWS credentials.

> **Beta.** Install with `shipzy@beta`. The main features have been run against a real AWS account, but there is no automated test suite yet and no independent security audit. Read [limits and roadmap](https://shipzy.quantav.xyz/docs/limits) first.

```sh
npm install -g shipzy@beta
export AWS_PROFILE=my-profile      # an IAM user or SSO profile, not root
shipzy init                        # creates the stack in your account (about 5 minutes)
shipzy deploy ./my-app --project demo
```

What you get: instant rollbacks (a routing change, no re-upload), a CloudFront address per project, custom domains with HTTPS, GitHub push deploys, pull request previews, build-time environment variables, builds in your own AWS account, `shipzy cost` for a monthly estimate, and an optional local dashboard (`shipzy dashboard`, downloaded on request).

- Documentation: https://shipzy.quantav.xyz/docs/getting-started
- Least-privilege IAM policy and script: https://shipzy.quantav.xyz/docs/aws-setup
- Source and issues: https://github.com/vaibhav0725/Shipzy

Requires Node.js 20 or newer. License: Apache-2.0.
