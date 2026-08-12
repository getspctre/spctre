# @spctre/mcp-server

## 0.1.3

### Patch Changes

- 6ffe2e5: Release the pending `@opentelemetry/auto-instrumentations-node` range bump.

  The dependency moved from `^0.78.0` to `^0.79.0` in the batched dependency
  update, but no changeset accompanied it, so the published 0.1.2 still resolves
  the older range and every install has been picking up instrumentation a major
  behind what this repository builds and tests against. Also carries the README
  formatting fix that landed with the Python tooling adoption.

  No source change to the server itself.

## 0.1.2

### Patch Changes

- 7871457: Advertise the real package version in the MCP `serverInfo` handshake. The
  version was a hardcoded literal (`"0.2.0"`) that had already drifted from the
  `0.1.1` package version, so clients saw a wrong version on `initialize`. It now
  resolves from `package.json` at runtime and can no longer drift.

## 0.1.1

### Patch Changes

- 51b9686: Prepare the MCP server for standalone npm publication by making its observability runtime self-contained and validating its packed artifact in release readiness.
