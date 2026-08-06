import { createHash } from "node:crypto";
import { basename } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { buildAgtRuntimeEvidenceV1 } from "../packages/policy-schema/src/schema.ts";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

const output = argument("--output");
const policyPath = argument("--policy");
const metadataPath = argument("--metadata");
const policyBytes = await readFile(policyPath);
const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
  toolkitVersion: string;
  packages: Array<{ package: string; version: string }>;
};

const evidence = buildAgtRuntimeEvidenceV1({
  generatedAt: new Date().toISOString(),
  toolkitVersion: metadata.toolkitVersion,
  materializedPolicyFilename: basename(policyPath),
  policyContentHash: `sha256:${createHash("sha256").update(policyBytes).digest("hex")}`,
  registeredTools: ["brief.file"],
  auditSinkTarget: "spctre://evidence/contract-test",
  agentId: "agt-contract-test",
  packages: metadata.packages,
});

await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
