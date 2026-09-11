---
"@spctre/policy-schema": minor
---

Add the governed-MCP operations-log event types (`MCP_TOOL_REGISTERED`, `MCP_TOOL_GRANTED`, `MCP_TOOL_REVOKED`) to `OperationsLogEventType`, so registry and grant changes can be read back from the log by type rather than by payload shape. `USAGE_RECONCILED` joins them: the worker has been writing it since the retained-event metering migration, and the union never listed it.
