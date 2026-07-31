# @spctre/mcp-server

## 0.1.2

### Patch Changes

- 7871457: Advertise the real package version in the MCP `serverInfo` handshake. The
  version was a hardcoded literal (`"0.2.0"`) that had already drifted from the
  `0.1.1` package version, so clients saw a wrong version on `initialize`. It now
  resolves from `package.json` at runtime and can no longer drift.

## 0.1.1

### Patch Changes

- 51b9686: Prepare the MCP server for standalone npm publication by making its observability runtime self-contained and validating its packed artifact in release readiness.
