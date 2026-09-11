---
"@spctre/mcp-server": patch
---

Expire the cached workspace MCP policy after 60 seconds. A successful load was previously kept for the life of the process, so granting an agent a capability changed nothing for any MCP server already running — with no expiry to wait out. The previously loaded allowlists stay in force while a refetch runs and if it fails, so an expiry never widens the gate.
