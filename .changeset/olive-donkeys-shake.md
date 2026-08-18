---
"@spctre/mcp-server": patch
---

Update `@opentelemetry/exporter-trace-otlp-http` to `^0.221.0`. It is a runtime
dependency, and under 0.x semantics the published range `^0.220.0` resolves
below 0.221.0 — so consumers of the released package would not otherwise pick
this up.
