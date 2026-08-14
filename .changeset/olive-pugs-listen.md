---
"@spctre/sdk": patch
---

Declare that `gatewayResolve` authenticates with a browser session rather than a
bearer key. Its description has always said so — resolving an escalation is a
human-in-the-loop decision the handler will not delegate to a service account —
but the operation inherited the global bearer requirement, so the generated
bindings advertised a delegation the API refuses.
