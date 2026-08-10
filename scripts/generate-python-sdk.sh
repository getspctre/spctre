#!/usr/bin/env bash
# Regenerates the private `spctre._generated` client from the OpenAPI spec.
#
# The generated tree IS checked in, unlike most generated output here. That is
# what lets CI assert the checkout matches the spec (see `pnpm check:python-sdk`
# and the "Python SDK is in sync" CI step), and it means building or installing
# the package needs no code generator at all.
#
# The generator is openapi-python-client (Python, httpx + attrs). It is pinned:
# regenerating with a different version produces a diff, which the drift check
# reports as a failure rather than letting it land silently.
#
# Requires uv. No JRE — that was the previous generator.
# Usage: bash scripts/generate-python-sdk.sh
set -euo pipefail

GENERATOR_VERSION="0.29.0"
SPEC="packages/api-contracts/openapi.json"
OUT="packages/sdk-python/spctre/_generated"

if [[ ! -f "$SPEC" ]]; then
  echo "Spec not found. Run: pnpm --filter @spctre/api-contracts emit" >&2
  exit 1
fi

# Regenerate from scratch so an operation or schema removed from the spec
# cannot survive as a stale module. The generator will not create the parent.
rm -rf "${OUT:?}"
mkdir -p "$(dirname "$OUT")"

# --meta none emits only the package tree: no pyproject, README or lockfile.
# Packaging metadata belongs to packages/sdk-python/pyproject.toml, which is
# what allows this distribution to declare its own requires-python and license.
uv tool run --from "openapi-python-client==${GENERATOR_VERSION}" \
  openapi-python-client generate \
  --path "$SPEC" \
  --meta none \
  --output-path "$OUT" \
  --overwrite

# The generator runs ruff over its output and leaves ruff's binary cache
# behind inside the package. Its contents differ between otherwise identical
# runs, which would both pollute the wheel and make the sync check flap.
rm -rf "$OUT/.ruff_cache"

echo "Generated spctre._generated with openapi-python-client ${GENERATOR_VERSION}"
