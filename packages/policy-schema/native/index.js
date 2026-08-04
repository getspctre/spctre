"use strict";

const { existsSync } = require("fs");
const { join } = require("path");

const { platform, arch } = process;

// Detect musl vs glibc on Linux.
function isMusl() {
  try {
    const { execFileSync } = require("child_process");
    return execFileSync("sh", ["-c", "ldd --version 2>&1 || true"]).toString().includes("musl");
  } catch {
    return true; // default to musl when detection fails
  }
}

function binding(name) {
  const local = join(__dirname, name);
  if (existsSync(local)) return require(local);
  throw new Error(
    `spctre_policy_core native addon not found at ${local}.\n` +
      'Run "cargo build --release" in packages/policy-schema/native and copy the output.',
  );
}

let nativeBinding;

if (platform === "darwin") {
  if (arch === "arm64") {
    nativeBinding = binding("spctre_policy_core.darwin-arm64.node");
  } else {
    nativeBinding = binding("spctre_policy_core.darwin-x64.node");
  }
} else if (platform === "linux") {
  if (isMusl()) {
    if (arch === "x64") {
      nativeBinding = binding("spctre_policy_core.linux-x64-musl.node");
    } else if (arch === "arm64") {
      nativeBinding = binding("spctre_policy_core.linux-arm64-musl.node");
    }
  } else {
    if (arch === "x64") {
      nativeBinding = binding("spctre_policy_core.linux-x64-gnu.node");
    } else if (arch === "arm64") {
      nativeBinding = binding("spctre_policy_core.linux-arm64-gnu.node");
    }
  }
}

if (!nativeBinding) {
  throw new Error(`spctre_policy_core: unsupported platform ${platform}/${arch}`);
}

module.exports = nativeBinding;
