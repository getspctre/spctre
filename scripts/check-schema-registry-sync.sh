#!/usr/bin/env bash
# Fails if the checked-in generated artifacts are not what `pnpm generate`
# produces from the current sources.
#
# The OpenAPI document and the schema-registry tree are both checked in, so
# they can drift in two directions: a source change landing without
# regeneration, or a hand-edit to a generated file. Both are silent without
# this check — every other job runs `pnpm generate` into its working tree
# before doing anything, so a stale artifact would be repaired in place and
# the build would stay green while the published contract no longer matched
# the code that serves it.
#
# Deliberately compares a content fingerprint taken before and after
# regeneration rather than consulting git. A git-based check reports whatever
# happens to be staged, so it false-positives on a branch that has not
# committed the tree yet and depends on HEAD already containing it.
set -euo pipefail

TARGETS=(
  "packages/api-contracts/openapi.json"
  "packages/api-contracts/schemas"
  "packages/policy-schema/schemas"
)

fingerprint() {
  python3 - "$@" <<'PY'
import hashlib
import pathlib
import sys

digest = hashlib.sha256()
for root in (pathlib.Path(a) for a in sys.argv[1:]):
    paths = sorted(p for p in root.rglob("*") if p.is_file()) if root.is_dir() else [root]
    for path in paths:
        digest.update(str(path).encode())
        digest.update(path.read_bytes())
print(digest.hexdigest())
PY
}

for target in "${TARGETS[@]}"; do
  if [[ ! -e "$target" ]]; then
    echo "$target is missing. Run 'pnpm generate'." >&2
    exit 1
  fi
done

before="$(fingerprint "${TARGETS[@]}")"
pnpm --filter @spctre/api-contracts emit >/dev/null
after="$(fingerprint "${TARGETS[@]}")"

if [[ "$before" != "$after" ]]; then
  echo "Generated API contracts are out of sync with their sources." >&2
  echo >&2
  git --no-pager diff --stat -- "${TARGETS[@]}" >&2 || true
  echo >&2
  echo "Run 'pnpm generate' and commit the result." >&2
  exit 1
fi

echo "Generated API contracts are in sync with their sources."
