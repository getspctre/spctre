---
"@spctre/mcp-server": patch
---

Every tool now declares the four MCP annotation hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) in `tools/list`, so clients no longer fall back to the spec's "destructive, open-world" defaults. Read tools are marked read-only. Tools that record decisions, evidence, escalations, or gateway events are marked as non-destructive writes.
