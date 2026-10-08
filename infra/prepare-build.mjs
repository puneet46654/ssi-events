// Adapts Puneet's Vercel-targeted app for AWS Lambda before `next build`.
// Run from the app directory: node ../infra/prepare-build.mjs
// Each step is a no-op once the change exists upstream, and fails loudly if the
// source has changed shape, so a sync can never silently ship an unpatched build.
import { readFileSync, writeFileSync } from 'node:fs';

function patch(file, describe, alreadyDone, apply) {
  const before = readFileSync(file, 'utf8');
  if (alreadyDone(before)) {
    console.log(`ok      ${file}: ${describe} (already upstream)`);
    return;
  }
  const after = apply(before);
  if (after === before || !alreadyDone(after)) {
    console.error(`FAILED  ${file}: could not ${describe}; update infra/prepare-build.mjs`);
    process.exit(1);
  }
  writeFileSync(file, after);
  console.log(`patched ${file}: ${describe}`);
}

// 1. Self-contained server bundle (.next/standalone) that Lambda can run.
patch(
  'next.config.ts',
  "set output: 'standalone'",
  (src) => /output:\s*['"]standalone['"]/.test(src),
  (src) => src.replace(/(const nextConfig[^=]*=\s*\{)/, "$1\n  output: 'standalone',"),
);

// 2. S3 client: use the Lambda role's temporary credentials (default provider chain).
//    The explicit key/secret pair drops the session token, so every S3 call would fail.
patch(
  'lib/s3.ts',
  'use the default AWS credential chain',
  (src) => !/AWS_SECRET_ACCESS_KEY/.test(src),
  (src) => src.replace(/\n[ \t]*credentials:\s*\{[^}]*AWS_SECRET_ACCESS_KEY[^}]*\},?/, ''),
);
