#!/usr/bin/env node
import { execSync } from "child_process";
import { copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const nativeDir = join(__dirname, "..", "native");

const { platform, arch } = process;
const key = `${platform}-${arch}`;

const libName = { darwin: "libspctre_policy_core.dylib", linux: "libspctre_policy_core.so" }[
  platform
];
const nodeName = {
  "darwin-arm64": "spctre_policy_core.darwin-arm64.node",
  "darwin-x64": "spctre_policy_core.darwin-x64.node",
  "linux-x64": "spctre_policy_core.linux-x64-gnu.node",
  "linux-arm64": "spctre_policy_core.linux-arm64-gnu.node",
}[key];

if (!libName || !nodeName) {
  console.error(`[build:native] Unsupported platform: ${key}`);
  process.exit(1);
}

console.log(`[build:native] Building Rust addon for ${key}...`);
execSync("cargo build --release", { cwd: nativeDir, stdio: "inherit" });

copyFileSync(join(nativeDir, "target", "release", libName), join(nativeDir, nodeName));
console.log(`[build:native] → native/${nodeName}`);
