import { createRequire } from "node:module";

// Resolve the CLI version from package.json at runtime so `--version` (and the
// SARIF tool driver) always reflect the published package version instead of a
// hand-maintained literal that silently drifts on every release.
const requirePkg = createRequire(__filename);
const { version } = requirePkg("../package.json") as { version: string };

export const SPCTRE_VERSION = version;
