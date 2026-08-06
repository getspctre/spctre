#!/usr/bin/env bash
# Validate the policy-schema adapter with the real, hash-locked AGT verifier.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
environment="$(mktemp -d "${TMPDIR:-/tmp}/spctre-agt-contract.XXXXXX")"
evidence_dir="$environment/evidence"
trap 'rm -rf "$environment"' EXIT

uv venv --clear "$environment" --quiet
uv pip sync --python "$environment/bin/python" --require-hashes "$root/scripts/agt-requirements.lock" --quiet
mkdir "$evidence_dir"

policy="$evidence_dir/policy.yaml"
cp "$root/packages/policy-schema/tests/fixtures/agt-runtime-evidence-contract.policy.yaml" "$policy"
metadata="$evidence_dir/toolkit.json"
"$environment/bin/python" -c '
import importlib.metadata as metadata
import json
names = [
    "agent-governance-toolkit",
    "agent-governance-toolkit-cli",
    "agent-governance-toolkit-core",
    "agent-governance-toolkit-integrations",
    "agent-governance-toolkit-protocols",
]
print(json.dumps({
    "toolkitVersion": metadata.version(names[0]),
    "packages": [{"package": name, "version": metadata.version(name)} for name in names],
}))
' > "$metadata"

pnpm exec tsx "$root/scripts/emit-agt-runtime-evidence-contract.mts" \
  --output "$evidence_dir/evidence.json" \
  --policy "$policy" \
  --metadata "$metadata"

(cd "$evidence_dir" && "$environment/bin/agt" verify --evidence evidence.json --strict)
