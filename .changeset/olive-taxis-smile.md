---
"@spctre/mcp-server": patch
---

Stop double-encoding ids read from resource URIs. The id arrives percent-encoded
and must leave percent-encoded, so encoding it as read escaped the escapes:
`%2F` travelled as `%252F` and matched no record. Decode once, then encode once.
