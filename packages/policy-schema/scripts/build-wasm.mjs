// Builds the portable kernel and stages it inside the package.
//
// The artifact is committed to the published tarball rather than built on
// install: a portable host is one that could not build a native addon, so it
// cannot be asked to run cargo either.

import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NATIVE_ROOT = join(PACKAGE_ROOT, "native");
const TARGET = "wasm32-unknown-unknown";
const OUT = join(NATIVE_ROOT, "spctre_policy_core.wasm");

const toolchain = execSync("rustup show active-toolchain", { encoding: "utf8" }).split(" ")[0];
execSync(`rustup target add --toolchain ${toolchain} ${TARGET}`, { stdio: "inherit" });
execSync(
  `rustup run ${toolchain} cargo build --release --target ${TARGET} --no-default-features --features wasm`,
  { cwd: NATIVE_ROOT, stdio: "inherit" },
);

mkdirSync(dirname(OUT), { recursive: true });
copyFileSync(join(NATIVE_ROOT, "target", TARGET, "release", "spctre_policy_core.wasm"), OUT);
console.log(`[build:wasm] → native/spctre_policy_core.wasm`);
