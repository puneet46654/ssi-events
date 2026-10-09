#!/usr/bin/env bash
# Turns a finished `next build` (output: 'standalone') into:
#   dist/web.zip     — the frontend server, run on Lambda by the Lambda Web Adapter layer
#   dist/static/     — hashed /_next/static assets, served by CloudFront from S3
# Usage (from the repo root): bash infra/package-lambda.sh frontend
set -euo pipefail

APP_DIR="${1:?usage: package-lambda.sh <app-dir>}"
STANDALONE="$APP_DIR/.next/standalone"
test -f "$STANDALONE/server.js" || { echo "No standalone build in $STANDALONE" >&2; exit 1; }

mkdir -p dist/static/_next
cp -r "$APP_DIR/.next/static" dist/static/_next/static

# public/ is served by the Next server itself (logos, fonts, favicon).
cp -r "$APP_DIR/public" "$STANDALONE/public"

# /var/task is read-only on Lambda; point Next's runtime cache (image optimizer) at /tmp.
rm -rf "$STANDALONE/.next/cache"
ln -s /tmp/next-cache "$STANDALONE/.next/cache"

cat > "$STANDALONE/run.sh" <<'RUN'
#!/bin/bash
mkdir -p /tmp/next-cache
exec node server.js
RUN
chmod +x "$STANDALONE/run.sh"

(cd "$STANDALONE" && zip -qry "$OLDPWD/dist/web.zip" .)
ls -l dist/web.zip
