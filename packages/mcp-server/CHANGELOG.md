# @spctre/mcp-server

## 0.2.0

### Minor Changes

- eccb81a: Enforce caller authentication and correct resource routing on the HTTP transport.

  HTTP requests are now executed with the caller's own bearer token only: the
  per-request config no longer falls back to the service `SPCTRE_API_TOKEN`, and
  no longer carries `SPCTRE_API_REFRESH_TOKEN`. Previously an expired caller
  token produced a 401 that was retried with an access token minted from the
  service refresh token, promoting the caller to the service identity.

  `SPCTRE_MCP_REQUIRE_BEARER_AUTH=false` is no longer supported — the HTTP
  transport refuses to start, because without a service-credential fallback every
  upstream call would be unauthenticated. `SPCTRE_API_TOKEN` and
  `SPCTRE_API_REFRESH_TOKEN` now apply to STDIO mode only.

  Also fixes two resource defects: `spctre://agents/<agent-id>/audit` took the
  agent ID from the URI authority (always `agents`) instead of the path, and
  `spctre://approvals/queue` was dispatched after the approval-ID route, making
  the queue resource unreachable. Resource read spans now use a bounded route
  label instead of embedding decision, approval, and principal IDs.

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
