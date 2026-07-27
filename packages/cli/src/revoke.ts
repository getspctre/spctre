import * as fs from "node:fs";
import * as path from "node:path";
import { readConfig, configPath } from "./config";
import { getOutputFormat, printJson } from "./output";

export async function revoke(options: { output?: string } = {}) {
  const format = getOutputFormat(options.output);
  const config = readConfig();

  if (!config) {
    console.error("No .spctre/config.json found. Nothing to revoke.");
    process.exit(1);
  }

  const url = `${config.controlPlaneUrl.replace(/\/+$/, "")}/api/token/revoke`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => res.statusText);
      throw new Error(`Server returned ${res.status}: ${body}`);
    }
  } catch (err) {
    // If the token is already dead or the server is unreachable, still clean up locally.
    console.warn(`Warning: could not reach control plane to revoke server-side tokens: ${String(err)}`);
    console.warn("Removing local config anyway.");
  }

  // Back up then remove the config so subsequent CLI calls require re-init.
  const cfgPath = configPath();
  const backupPath = path.join(path.dirname(cfgPath), "config.revoked.json");
  try {
    fs.copyFileSync(cfgPath, backupPath);
    fs.unlinkSync(cfgPath);
  } catch {
    // If the file is already gone, that's fine.
  }

  if (format === "json") {
    printJson({ ok: true, backupPath });
  } else {
    console.log("Agent disconnected. Tokens revoked.");
    console.log(`Config backed up to ${backupPath}`);
    console.log("Run spctre init to reconnect.");
  }
}
