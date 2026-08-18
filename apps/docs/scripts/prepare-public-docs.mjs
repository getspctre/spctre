import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, parse, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { hostedOnlyDocuments, mixedAudienceDocuments } from "../lib/public-docs-policy.mjs";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(appDir, "..", "web", "content", "docs");
const outputDir = join(appDir, ".generated-public-docs");
const hostedOnlyTerms = /\b(SPCTRE_PLAN|SIEM event streaming|SCIM provisioning|Cross-surface agent identity|Bulk production simulation|SLA-tracked HITL|Managed workflow enforcement|Compliance PDF export|Multi-tenant workspace isolation|Custom roles and granular grants)\b/i;

async function removeFromNavigation(documentPath) {
  const { dir, name } = parse(documentPath);
  const metaPath = join(outputDir, dir, "meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8"));

  if (Array.isArray(meta.pages)) {
    meta.pages = meta.pages.filter((page) => page !== name);
    await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  }
}

async function writeHostedNotice(documentPath) {
  const outputPath = join(outputDir, documentPath);
  await writeFile(
    outputPath,
    `---\ntitle: Hosted documentation\ndescription: This documentation is available in the Spctre control plane.\n---\n\nThis guide is available to hosted customers in the Spctre control plane, where documentation is matched to the deployment and enabled capabilities.\n\nFor the Apache-2.0 distribution, return to the [open-source documentation](/).\n`,
  );
}

async function assertOssOnly(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await assertOssOnly(path);
    else if (entry.name.endsWith(".mdx") && hostedOnlyTerms.test(await readFile(path, "utf8"))) {
      throw new Error(`Hosted-only documentation leaked into the public corpus: ${path}`);
    }
  }
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(sourceDir, outputDir, { recursive: true });

for (const documentPath of hostedOnlyDocuments) {
  await rm(join(outputDir, documentPath));
  await removeFromNavigation(documentPath);
}

for (const documentPath of mixedAudienceDocuments) {
  await removeFromNavigation(documentPath);
  await writeHostedNotice(documentPath);
}

await assertOssOnly(outputDir);

const manifest = {
  hostedOnly: hostedOnlyDocuments.map((documentPath) => relative(outputDir, join(sourceDir, documentPath))),
  mixed: mixedAudienceDocuments.map((documentPath) => relative(outputDir, join(sourceDir, documentPath))),
};
await writeFile(
  join(outputDir, ".publication-manifest.json"),
  `${JSON.stringify({ audience: "public", ...manifest }, null, 2)}\n`,
);
