---
"@spctre/mcp-server": patch
---

Advertise the real package version in the MCP `serverInfo` handshake. The
version was a hardcoded literal (`"0.2.0"`) that had already drifted from the
`0.1.1` package version, so clients saw a wrong version on `initialize`. It now
resolves from `package.json` at runtime and can no longer drift.
