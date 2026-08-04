import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const scope = valueAfter("--scope") ?? "all";

const targets = [
  { scope: "web", path: "apps/web/.next", reason: "Next.js build and dev cache" },
  { scope: "web", path: "apps/web/.source", reason: "Fumadocs generated source output" },
  { scope: "worker", path: "apps/worker/dist", reason: "Worker build output" },
  { scope: "packages", path: "packages/cli/dist", reason: "CLI build output" },
  { scope: "packages", path: "packages/mcp-server/dist", reason: "MCP server build output" },
  { scope: "packages", path: "packages/policy-schema/dist", reason: "Policy schema build output" },
  {
    scope: "packages",
    path: "packages/policy-schema/native/target",
    reason: "Native policy schema build output",
  },
  { scope: "packages", path: "packages/ui/storybook-static", reason: "Storybook static output" },
  { scope: "root", path: ".turbo", reason: "Turborepo cache" },
  { scope: "root", path: "target", reason: "Root build output" },
];

const selectedTargets = targets.filter((target) => scope === "all" || target.scope === scope);

if (!selectedTargets.length) {
  console.error(
    `Unknown cleanup scope "${scope}". Expected one of: all, web, worker, packages, root.`,
  );
  process.exit(1);
}

let reclaimableBytes = 0;
let removedCount = 0;

for (const target of selectedTargets) {
  const absolutePath = join(root, target.path);
  if (!existsSync(absolutePath)) continue;

  const bytes = sizeOf(absolutePath);
  reclaimableBytes += bytes;
  const label = `${target.path} (${formatBytes(bytes)}): ${target.reason}`;

  if (force) {
    rmSync(absolutePath, { recursive: true, force: true });
    removedCount += 1;
    console.log(`Removed ${label}`);
  } else {
    console.log(`Would remove ${label}`);
  }
}

if (force) {
  console.log(
    `Cleaned ${removedCount} path(s), reclaimed approximately ${formatBytes(reclaimableBytes)}.`,
  );
} else {
  console.log(
    `Dry run complete. Reclaimable space: approximately ${formatBytes(reclaimableBytes)}.`,
  );
  console.log("Run with --force to remove these generated artifacts.");
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

function sizeOf(path) {
  try {
    const output = execFileSync("du", ["-sk", path], { encoding: "utf8" });
    const kilobytes = Number.parseInt(output.trim().split(/\s+/)[0] ?? "0", 10);
    return kilobytes * 1024;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)}${units[unitIndex]}`;
}
