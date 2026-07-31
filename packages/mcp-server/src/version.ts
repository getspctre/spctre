import { createRequire } from "node:module";

// Resolve the server version from package.json at runtime so the MCP
// `serverInfo.version` advertised in the initialize handshake always matches the
// published package instead of a hand-maintained literal that silently drifts.
const requirePkg = createRequire(__filename);
const { version } = requirePkg("../package.json") as { version: string };

export const SPCTRE_MCP_VERSION = version;
