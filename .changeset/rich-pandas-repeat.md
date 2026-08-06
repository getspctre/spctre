---
"@spctre/sdk": patch
---

Document `approvedToolParameters` as a confirmation of the reviewed decision
arguments rather than an execution source. The value is redacted and bounded
when the decision is recorded, so consumers should execute from the parameters
they already hold and use this field to confirm they match what was approved.
