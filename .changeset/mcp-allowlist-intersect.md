---
"@spctre/mcp-server": patch
---

Stop workspace MCP policy from widening the operator's env-var allowlists. The
fetched policy is now a second constraint that a tool call must satisfy
alongside `SPCTRE_ALLOWED_TOOLS`/`SPCTRE_ALLOWED_CONNECTORS`, instead of being
unioned into them — previously the workspace list (the full first-party tool
surface) silently erased a narrower operator allowlist on the first tool call.
