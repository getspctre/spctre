---
"@spctre/sdk": minor
---

Add the Docker AI Governance ingest endpoint to the generated bindings, and
correct four documented paths that the API did not actually serve at their
published URL.

`/bundle/latest/custody`, `/evidence/policy-artifacts`,
`/evidence/policy-artifacts/{contentHash}`, and `/gateway/escalations/agt` were
described in the spec, and so present in the SDK, while only existing on the
unversioned routes — calling them through the client hit a URL with nothing
behind it. They are now served at `/api/v1` like every other documented path.
