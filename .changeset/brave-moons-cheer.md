---
"@spctre/mcp-server": minor
---

Derive `policies_count` and `connectors` in `get_policy_status` from the
published bundle rather than from `/api/adapters`. The count measured adapter
declarations, not policies, and `connectors` carried the whole `{ adapters,
meta }` response body instead of a list. Adapter declarations now report under
`adapters`, the name they actually carry.
