---
"@spctre/mcp-server": patch
---

Honour `SPCTRE_TRUSTED_PROXY_HOPS` when deriving the client address for the
source-IP allowlist and rate-limit key, matching the control plane. Without it
the leftmost `x-forwarded-for` entry is caller-supplied and the allowlist can be
bypassed.
