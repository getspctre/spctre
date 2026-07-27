# Public repository contract

`getspctre/spctre` is the canonical upstream for OSS code and shared contracts.
Private Enterprise implementations are layered separately and must not be copied
into this repository.

When a change affects a shared interface, schema, API contract, or OSS runtime
behavior, land it here first. The private source then consumes that public commit
before adding Enterprise-only behavior. The public-boundary workflow rejects
private knowledge, operations, concept, and Enterprise source directories.
