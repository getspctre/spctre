#!/usr/bin/env bash
# Generates the spctre-sdk Python package from the published OpenAPI spec.
# Prerequisites: JRE 11+ and @openapitools/openapi-generator-cli installed.
#   pnpm add -Dw @openapitools/openapi-generator-cli
# Usage: bash scripts/generate-python-sdk.sh [output-dir]
set -euo pipefail

SPEC="packages/api-contracts/openapi.json"
OUT="${1:-target/sdk-python}"
# The release workflow overrides this to publish a version other than the
# development default (for example a .devN suffix for TestPyPI dry runs).
VERSION="${SPCTRE_SDK_VERSION:-0.1.0}"

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
packageVersion="$VERSION",\
projectName=spctre-sdk,\
packageUrl=https://github.com/getspctre/spctre,\
gitUserId=getspctre,\
gitRepoId=spctre,\
httpUserAgent=spctre-sdk-python/"$VERSION",\
generateSourceCodeOnly=false

echo "Python SDK $VERSION written to $OUT"
