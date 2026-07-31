---
"@spctre/cli": patch
---

Report the real package version from `spctre --version`. The version was a
hardcoded `"0.1.0"` literal that never tracked the published package, so the CLI
kept reporting `0.1.0` after every release. It (and the SARIF tool-driver
version) now resolve from `package.json` at runtime and can no longer drift.
