#!/usr/bin/env bash
# Generates the `spctre` client package from the published OpenAPI spec, into
# the checked-in packages/sdk-python distribution.
#
# The distribution ships two top-level packages:
#   spctre      — generated here, gitignored, regenerated from the spec
#   spctre_sdk  — the hand-written supported facade, checked in
#
# Only the source tree is generated (generateSourceCodeOnly=true): packaging
# metadata comes from packages/sdk-python/pyproject.toml, not from the
# generator's own setup.py. That is what lets the distribution declare its own
# requires-python, license and authors.
#
# Prerequisites: JRE 11+ and @openapitools/openapi-generator-cli.
#   brew install openjdk   # or any JDK on PATH
# Usage: bash scripts/generate-python-sdk.sh [output-dir]
set -euo pipefail

SPEC="packages/api-contracts/openapi.json"
OUT="${1:-packages/sdk-python}"
# The release workflow overrides this to publish a version other than the
# development default (for example a .devN suffix for TestPyPI dry runs).
VERSION="${SPCTRE_SDK_VERSION:-0.1.0}"

if [[ ! -f "$SPEC" ]]; then
  echo "Spec not found. Run: pnpm --filter @spctre/api-contracts emit" >&2
  exit 1
fi

# Regenerate from scratch so an operation removed from the spec cannot survive
# as a stale module in the published package.
rm -rf "${OUT:?}/spctre"

npx @openapitools/openapi-generator-cli generate \
  -i "$SPEC" \
  -g python \
  -o "$OUT" \
  --package-name spctre \
  --git-user-id getspctre \
  --git-repo-id spctre \
  --global-property=apiTests=false,modelTests=false,apiDocs=false,modelDocs=false \
  --additional-properties=\
packageVersion="$VERSION",\
projectName=spctre-sdk,\
packageUrl=https://github.com/getspctre/spctre,\
httpUserAgent=spctre-sdk-python/"$VERSION",\
generateSourceCodeOnly=true

# generateSourceCodeOnly=true suppresses the packaging files we do not want,
# but it also suppresses py.typed, which we do: without it the generated
# annotations are invisible to consumers' type checkers. Restore it, and drop
# the loose README the generator leaves beside the package.
touch "$OUT/spctre/py.typed"
rm -f "$OUT/spctre_README.md"

echo "Generated spctre client $VERSION into $OUT"
