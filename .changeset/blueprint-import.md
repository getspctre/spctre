---
"@spctre/policy-schema": minor
"@spctre/cli": minor
"@spctre/sdk": minor
---

Add operator/CI Blueprint import support.

- **@spctre/cli**: new `spctre blueprint import <file>` command (operator/CI only). Imports a declarative Blueprint source into the control plane as an unapproved draft via `POST /api/v1/blueprint/imports`; never approves or publishes. `--dry-run` validates the source offline.
- **@spctre/policy-schema**: new `parseAgentBlueprintSource` export (parses a YAML/JSON Blueprint source envelope into `{ name, agentId, message, definition }`; rejects any source that pins `policyRevisionId`). Consumed by the CLI's dry-run/validation path.
- **@spctre/sdk**: regenerated to include the new `importBlueprint` (`POST /blueprint/imports`) operation.
