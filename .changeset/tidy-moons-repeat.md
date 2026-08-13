---
"@spctre/cli": patch
---

`spctre cloud login --trial` no longer prints the trial's capacity and retention
in its banner. Those numbers come from the deployment's entitlement catalog,
which the CLI cannot read, so the banner was a copy that drifted — it advertised
7-day retention against a catalog granting 90. The approval page reads the
catalog and states the terms before you accept.
