---
"@spctre/sdk": minor
---

Add the policy review and publish endpoints to the generated client: `POST /approvals`, `POST /policy/publishes`, and `GET /policy/publishes/readiness`. A pipeline can now approve and publish through the reviewed path, as the reviewer principal its key belongs to, rather than through a support API that bypassed review.
