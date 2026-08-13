---
"@spctre/mcp-server": minor
---

Enforce caller authentication and correct resource routing on the HTTP transport.

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
