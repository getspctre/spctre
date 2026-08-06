---
"@spctre/policy-schema": minor
---

Extract the `classifySemanticIntent` vocabulary into shared, exported tables.

- New exports: `SEMANTIC_TOPICS`, `SEMANTIC_STOP_WORDS`, `SEMANTIC_GENERIC_WORDS`, `SEMANTIC_MATCH_RATIO`, and the `SemanticTopic` type.
- `classifySemanticIntent` now reads its safety-topic triggers and keyword sets from those tables instead of inlining them. Behaviour is unchanged — the refactor was verified against the previous implementation across 344,064 input combinations.

The tables are the single source of truth for the gateway's semantic matching vocabulary, so the Go worker's decision engine can be generated from them rather than duplicating the keyword lists by hand.
