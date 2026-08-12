---
"@spctre/mcp-server": patch
---

Release the pending `@opentelemetry/auto-instrumentations-node` range bump.

The dependency moved from `^0.78.0` to `^0.79.0` in the batched dependency
update, but no changeset accompanied it, so the published 0.1.2 still resolves
the older range and every install has been picking up instrumentation a major
behind what this repository builds and tests against. Also carries the README
formatting fix that landed with the Python tooling adoption.

No source change to the server itself.
