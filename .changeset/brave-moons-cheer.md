---
"@spctre/mcp-server": patch
---

Return `connectors` from `get_policy_status` as an array. `/api/adapters`
answers `{ adapters, meta }`, and the whole body was being assigned, so callers
received an object and `policies_count` was undefined.
