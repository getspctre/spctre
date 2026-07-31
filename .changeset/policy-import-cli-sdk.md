---
"@spctre/cli": minor
"@spctre/sdk": minor
---

Publish the local-first policy import surface (#28), which merged after the
last release:

- `@spctre/cli`: new `spctre policy import` command that imports a local
  AGT-compatible policy document into the control plane as an unapproved draft
  revision, for operators and CI. Idempotent on the branch identity and source
  hash; never approves or publishes.
- `@spctre/sdk`: regenerated types for the new `POST /policy/imports` operation
  (`importPolicy`, `PolicyImportRequest`), so consumers can call the endpoint
  with full typing.
