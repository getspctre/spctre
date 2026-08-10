---
"@spctre/cli": patch
---

Treat a workspace with no published policy bundle as a normal starting state
rather than a fatal error.

`GET /api/bundle/latest` returns 404 until a workspace publishes its first
bundle. `sync` turned that into `Sync failed: ... (404)` followed by
`process.exit(1)`, which took down `spctre watch` on its very first poll and
aborted `spctre init` while onboarding a fresh workspace.

`sync` now reports the absence through a new `published` flag on `SyncResult`
instead of exiting, and leaves any previously synced bundle file on disk
untouched. `spctre watch` keeps polling and picks the bundle up automatically
once one is published, reporting the state only when it changes. Heartbeats are
skipped while no bundle is published, because a heartbeat records the artifact
hash of the bundle an agent is running and there is none to report yet.

Genuine failures — auth, connectivity, and any other non-404 response — remain
fatal.
