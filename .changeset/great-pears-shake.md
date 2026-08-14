---
"@spctre/sdk": minor
---

Add bindings for nine governed reads that the API already served but never
described: workspaces, members, the approval queue, compliance status, an
agent's audit summary, trust history, identity events, workflow configuration,
and the MCP gateway-ingest receiver.

Each is now served at `/api/v1` alongside its unversioned route, so a client
can reach them at the versioned base like every other documented endpoint.
