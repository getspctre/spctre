---
"@spctre/mcp-server": patch
---

Treat an empty `allowedTools`/`allowedConnectors` array in the workspace MCP
policy as an explicit deny-all rather than as no policy, so a workspace can be
frozen pending review. An omitted field still leaves the layer unconstrained.
