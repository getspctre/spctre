#!/usr/bin/env bash
# Generates the spctre-sdk Python package from the published OpenAPI spec.
# Prerequisites: JRE 11+ and @openapitools/openapi-generator-cli installed.
#   pnpm add -Dw @openapitools/openapi-generator-cli
# Usage: bash scripts/generate-python-sdk.sh [output-dir]
set -euo pipefail

SPEC="packages/api-contracts/openapi.json"
OUT="${1:-target/sdk-python}"

if [[ ! -f "$SPEC" ]]; then
  echo "Spec not found. Run: pnpm --filter @spctre/api-contracts emit" >&2
  exit 1
fi

npx @openapitools/openapi-generator-cli generate \
  -i "$SPEC" \
  -g python \
  -o "$OUT" \
  --package-name spctre \
  --additional-properties=\
packageVersion=0.1.0,\
projectName=spctre-sdk,\
packageUrl=https://github.com/spctre/spctre,\
httpUserAgent=spctre-sdk-python/0.1.0,\
generateSourceCodeOnly=false

echo "Python SDK written to $OUT"
