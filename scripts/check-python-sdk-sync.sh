#!/usr/bin/env bash
# Fails if packages/sdk-python/spctre/_generated is not what the pinned
# generator produces from the current spec.
#
# The generated client is checked in, so it can drift in two directions: a spec
# change landing without regeneration, or a hand-edit to generated code. Both
# are silent without this check — the package would keep building and testing
# green while no longer matching the API it claims to describe.
#
# Deliberately compares a content fingerprint taken before and after
# regeneration rather than consulting git. A git-based check reports whatever
# happens to be staged, so it false-positives on a branch that has not
# committed the tree yet and depends on HEAD already containing it.
set -euo pipefail

TARGET="packages/sdk-python/spctre/_generated"

fingerprint() {
  python3 - "$1" <<'PY'
import hashlib
import pathlib
import sys

root = pathlib.Path(sys.argv[1])

# Only generated source counts. Importing the package writes __pycache__ into
# this tree, and regeneration removes the directory wholesale — so counting
# bytecode would make this check fail purely because the tests ran first.
def tracked(path: pathlib.Path) -> bool:
    if not path.is_file():
        return False
    if path.suffix in {".pyc", ".pyo"}:
        return False
    return "__pycache__" not in path.parts

digest = hashlib.sha256()
for path in sorted(p for p in root.rglob("*") if tracked(p)):
    digest.update(str(path.relative_to(root)).encode())
    digest.update(path.read_bytes())
print(digest.hexdigest())
PY
}

if [[ ! -d "$TARGET" ]]; then
  echo "$TARGET is missing. Run 'pnpm generate:python-sdk'." >&2
  exit 1
fi

before="$(fingerprint "$TARGET")"
bash scripts/generate-python-sdk.sh >/dev/null
after="$(fingerprint "$TARGET")"

if [[ "$before" != "$after" ]]; then
  echo "Python SDK is out of sync with packages/api-contracts/openapi.json." >&2
  echo >&2
  git --no-pager diff --stat -- "$TARGET" >&2 || true
  echo >&2
  echo "Run 'pnpm generate:python-sdk' and commit the result." >&2
  exit 1
fi

echo "Python SDK is in sync with the spec."
