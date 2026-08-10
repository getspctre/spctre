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

# Generate outside the repository, then move the result into place.
#
# The generator finishes by running ruff over its own output, and ruff finds
# its config by walking up from the files it is given. Generating in place
# would let the repository's ruff.toml drive that pass — our line width and
# lint selection would silently change what the generator produces, and
# excluding the directory would suppress the generator's fixups instead of
# leaving them alone. Generating under a temporary directory keeps the output
# a pure function of the spec and the pinned generator version.
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# Pin the target version for the generator's ruff pass. Without a config ruff
# falls back to its default target, which emits `from typing_extensions import
# Self` — a runtime import of a package this distribution does not depend on.
# Stating 3.11 explicitly gets `typing.Self` and keeps the output a function of
# inputs we control rather than of ruff's defaults.
cat > "$WORKDIR/ruff.toml" <<'RUFF'
target-version = "py311"
RUFF

# --meta none emits only the package tree: no pyproject, README or lockfile.
# Packaging metadata belongs to packages/sdk-python/pyproject.toml, which is
# what allows this distribution to declare its own requires-python and license.
uv tool run --from "openapi-python-client==${GENERATOR_VERSION}" \
  openapi-python-client generate \
  --path "$(cd "$(dirname "$SPEC")" && pwd)/$(basename "$SPEC")" \
  --meta none \
  --output-path "$WORKDIR/_generated" \
  --overwrite

# The generator runs ruff over its output and leaves ruff's binary cache
# behind inside the package. Its contents differ between otherwise identical
# runs, which would both pollute the wheel and make the sync check flap.
rm -rf "$WORKDIR/_generated/.ruff_cache"

mv "$WORKDIR/_generated" "$OUT"

echo "Generated spctre._generated with openapi-python-client ${GENERATOR_VERSION}"
