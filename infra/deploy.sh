#!/usr/bin/env bash
# Publishes dist/ (from package-lambda.sh) to production:
# static assets to S3, server code to Lambda, then a CloudFront invalidation.
# Usage: infra/deploy.sh dist <release-id>
set -euo pipefail

DIST="${1:?usage: deploy.sh <dist-dir> <release-id>}"
RELEASE="${2:?usage: deploy.sh <dist-dir> <release-id>}"
BUCKET="${BUCKET:-ssi-events-site-051826716001}"
FUNCTION="${FUNCTION:-ssi-events-web}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:?set DISTRIBUTION_ID}"

# Hashed assets never change. No --delete: open browsers may still request the previous build's files.
aws s3 sync "$DIST/static/_next/static" "s3://$BUCKET/_next/static" \
  --cache-control "public, max-age=31536000, immutable" --no-progress

aws s3 cp "$DIST/lambda.zip" "s3://$BUCKET/releases/$RELEASE.zip" --no-progress
aws lambda update-function-code --function-name "$FUNCTION" \
  --s3-bucket "$BUCKET" --s3-key "releases/$RELEASE.zip" \
  --query '[FunctionName,CodeSha256,LastUpdateStatus]' --output text
aws lambda wait function-updated --function-name "$FUNCTION"

aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" \
  --query 'Invalidation.[Id,Status]' --output text
