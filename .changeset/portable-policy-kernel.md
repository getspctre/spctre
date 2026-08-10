---
"@spctre/policy-schema": minor
---

Ship the portable policy kernel. `@spctre/policy-schema/wasm` instantiates the
same bounded-JSON kernel the native addon and the Go worker use, with no
generated glue and no build toolchain, for hosts that cannot load a native
binary. `EvaluationResult` now exposes the evaluator and schema versions and the
policy artifact hash the kernel already returned, and the kernel's own resource
limits are readable rather than restated by callers.
