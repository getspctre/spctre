---
"@spctre/mcp-server": patch
---

Percent-encode decision, approval, and agent ids when building control-plane
paths. These are free-form strings by contract, so an id containing `/`, `?`, or
`#` was changing the shape of the request rather than its id.
