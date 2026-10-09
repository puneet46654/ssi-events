#!/usr/bin/env bash
# Builds backend/ into dist/api.zip for Lambda ssi-events-api (nodejs24.x, arm64):
#   index.mjs        — esbuild bundle of backend/src (AWS SDK comes from the Lambda runtime)
#   node_modules/    — sharp with its Linux arm64 binaries (native, so it can't be bundled)
# Usage (from the repo root): bash infra/package-backend.sh <release-id>
set -euo pipefail

RELEASE="${1:?usage: package-backend.sh <release-id>}"
SHARP_VERSION=$(node -p "require('./backend/package.json').dependencies.sharp")

(cd backend && npm run build -- "--define:process.env.RELEASE=\"$RELEASE\"")

PKG=$(mktemp -d)
cp backend/dist/index.mjs "$PKG/"
echo '{"name":"ssi-events-api-runtime","private":true,"type":"module"}' > "$PKG/package.json"
(cd "$PKG" && npm install --no-audit --no-fund --omit=dev --os=linux --cpu=arm64 --libc=glibc "sharp@$SHARP_VERSION")

mkdir -p dist
rm -f dist/api.zip
(cd "$PKG" && zip -qry "$OLDPWD/dist/api.zip" index.mjs package.json node_modules)
ls -l dist/api.zip
