---
"@spctre/mcp-server": patch
---

Retry a failed workspace MCP policy fetch after a 30s backoff instead of
stranding the session on env-var allowlists for its lifetime, and share a single
in-flight fetch across concurrent tool calls.
