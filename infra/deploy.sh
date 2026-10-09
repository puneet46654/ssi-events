#!/usr/bin/env bash
# Publishes the build artifacts to production:
#   dist/static/   → S3 (/_next/static, served by CloudFront)
#   dist/web.zip   → Lambda ssi-events-web (frontend)
#   dist/api.zip   → Lambda ssi-events-api (backend)
# then invalidates CloudFront. Usage: infra/deploy.sh <dist-dir> <release-id>
set -euo pipefail

DIST="${1:?usage: deploy.sh <dist-dir> <release-id>}"
RELEASE="${2:?usage: deploy.sh <dist-dir> <release-id>}"
BUCKET="${BUCKET:-ssi-events-site-051826716001}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:?set DISTRIBUTION_ID}"

# Hashed assets never change. No --delete: open browsers may still request the previous build's files.
aws s3 sync "$DIST/static/_next/static" "s3://$BUCKET/_next/static" \
  --cache-control "public, max-age=31536000, immutable" --no-progress

update_function() {   # <function> <zip>
  aws s3 cp "$2" "s3://$BUCKET/releases/$RELEASE/$(basename "$2")" --no-progress
  aws lambda update-function-code --function-name "$1" \
    --s3-bucket "$BUCKET" --s3-key "releases/$RELEASE/$(basename "$2")" \
    --query '[FunctionName,CodeSha256,LastUpdateStatus]' --output text
  aws lambda wait function-updated --function-name "$1"
}
# Backend first: the new frontend may call endpoints that only the new backend has.
update_function ssi-events-api "$DIST/api.zip"
update_function ssi-events-web "$DIST/web.zip"

aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" \
  --query 'Invalidation.[Id,Status]' --output text
