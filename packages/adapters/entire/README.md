# @spctre/entire-checkpoints

An optional adapter for Entire's checkpoint branch. It keeps Entire's private
Git layout outside the core Spctre CLI and sends normalized records to
`POST /api/v1/evidence/git-checkpoints`.

```ts
import { ingestEntireCheckpoints } from "@spctre/entire-checkpoints";

await ingestEntireCheckpoints({
  apiKey: process.env.SPCTRE_API_KEY!,
  baseUrl: "https://app.spctre.dev/api/v1",
  repositoryId: "github:acme/service",
  environment: "production",
});
```

Run it from a clone containing `entire/checkpoints/v1`, or pass `branch` for a
different checkpoint ref. Checkpoint IDs are used as stable idempotency keys.
