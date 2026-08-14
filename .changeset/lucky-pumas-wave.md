---
"@spctre/mcp-server": patch
---

Probe the control plane's health endpoint for readiness rather than its root.
The root is an application page behind the proxy's source-IP allowlist, so where
one is configured it answers 403 to this service — which egresses from a
platform address no operator allowlist can contain — and readiness reported the
upstream unreachable while it was serving requests normally.
