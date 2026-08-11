---
"@spctre/policy-schema": minor
---

Add the `GATEWAY_DECISION_REPLAY_DIVERGED` operations-log event type. Gateway
decisions are now first-write-wins audit records, so a replayed decision that
disagrees with the persisted one is retained as its own event rather than
rewriting the original.
