---
"@spctre/mcp-server": patch
---

Raise the OpenTelemetry SDK to 0.222.0 and keep the OTLP exporters and the
`sdk-node` override on the same release.

`@opentelemetry/sdk-node` and the `exporter-*-otlp-http` packages ship as one
lockstep release and resolve `@opentelemetry/core` through it, so moving the SDK
alone split `core` across two instances. The `>=0.220.0` workspace override also
outranks whatever the manifests ask for, so the bump reverted on the next
resolution. Both are corrected here.
