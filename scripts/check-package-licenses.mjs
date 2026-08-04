import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const root = process.cwd();
const blockedLicensePattern = /\b(AGPL|GPL|LGPL|SSPL|BUSL|Commons Clause)\b/i;
const packageJsons = [];
const warnings = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (
      [".git", ".next", ".pnpm-store", ".turbo", "dist", "node_modules", "target"].includes(entry)
    )
      continue;
    const path = join(dir, entry);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (relative(root, path).split(sep)[0] === "ee") continue;
      walk(path);
    } else if (entry === "package.json") {
      packageJsons.push(path);
    }
  }
}

walk(root);

const violations = [];

function packageJsonPathForDependency(name, manifestDir) {
  const candidates = [
    join(manifestDir, "node_modules", name, "package.json"),
    join(root, "node_modules", name, "package.json"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function installedLicenseForDependency(name, manifestDir) {
  const packageJsonPath = packageJsonPathForDependency(name, manifestDir);
  if (!packageJsonPath) return null;

  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return manifest.license ?? manifest.licenses ?? null;
}

function licenseToText(value) {
  if (Array.isArray(value)) {
    return value.map(licenseToText).join(" ");
  }
  if (value && typeof value === "object") {
    return Object.values(value).map(licenseToText).join(" ");
  }
  return String(value);
}

for (const file of packageJsons) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (manifest.license && blockedLicensePattern.test(String(manifest.license))) {
    violations.push(`${relative(root, file)} declares blocked license "${manifest.license}"`);
  }

  const allDeps = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  };

  for (const [name, spec] of Object.entries(allDeps)) {
    if (String(spec).startsWith("workspace:")) {
      continue;
    }

    const installedLicense = installedLicenseForDependency(name, dirname(file));
    if (!installedLicense) {
      warnings.push(
        `${relative(root, file)} could not resolve installed license for ${name}@${spec}`,
      );
      continue;
    }

    const licenseText = licenseToText(installedLicense);

    if (blockedLicensePattern.test(licenseText)) {
      violations.push(
        `${relative(root, file)} depends on ${name}@${spec} with blocked license "${licenseText}"`,
      );
    }
  }
}

if (violations.length) {
  console.error("Blocked dependency license found in non-ee package manifests.\n");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

for (const warning of warnings) console.warn(`Warning: ${warning}`);
console.log("Package license manifest check passed.");
