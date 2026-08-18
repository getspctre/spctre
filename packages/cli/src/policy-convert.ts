import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { parsePolicySourceDocument } from "@spctre/policy-schema";
import { getOutputFormat, printJson, type OutputFormat } from "./output";

export interface PolicyConvertOptions {
  output?: string;
  report?: string;
  sourceFormat?: "AGT_YAML" | "OPA_REGO" | "CEDAR";
  format?: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function validateSourceFormat(value: unknown): "AGT_YAML" | "OPA_REGO" | "CEDAR" | undefined {
  if (value === undefined) return undefined;
  if (value === "AGT_YAML" || value === "OPA_REGO" || value === "CEDAR") return value;
  return fail("Error: --source-format must be AGT_YAML, OPA_REGO, or CEDAR.");
}

/** Convert locally only; it never contacts or creates a control-plane revision. */
export async function policyConvert(
  file: string | undefined,
  options: PolicyConvertOptions,
): Promise<void> {
  if (!file) fail("Error: a policy file path is required. Usage: spctre policy convert <file>");
  const inputPath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(inputPath)) fail(`Error: policy file not found: ${inputPath}`);
  const source = fs.readFileSync(inputPath, "utf8");
  const parsed = parsePolicySourceDocument({
    document: source,
    sourcePath: path.relative(process.cwd(), inputPath) || path.basename(inputPath),
    sourceFormat: validateSourceFormat(options.sourceFormat),
  });
  const format: OutputFormat = getOutputFormat(options.format);
  const result = {
    ok: !parsed.diagnostics.some((diagnostic) => diagnostic.severity === "ERROR"),
    sourceFormat: parsed.sourceFormat ?? "AGT_YAML",
    sourceHash: `sha256:${createHash("sha256").update(source).digest("hex")}`,
    sourceDocument: parsed.sourceDocument,
    rules: parsed.rules,
    diagnostics: parsed.diagnostics,
    warnings: parsed.warnings,
    translation: parsed.translation,
    deferredChecks: [
      "Control-plane authorization, persistence, review, approval, and publication.",
      "Workspace/runtime context and external data-provider validation.",
    ],
  };
  if (!result.ok) {
    if (format === "json") printJson(result);
    else for (const diagnostic of parsed.diagnostics) console.error(`${diagnostic.severity}: ${diagnostic.message}`);
    process.exit(1);
  }
  const artifact = `${JSON.stringify(parsed.sourceDocument, null, 2)}\n`;
  if (options.output) fs.writeFileSync(path.resolve(process.cwd(), options.output), artifact, "utf8");
  if (options.report) fs.writeFileSync(path.resolve(process.cwd(), options.report), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (format === "json") {
    printJson(result);
  } else {
    console.log(`Converted ${parsed.rules.length} rule(s) locally; no revision was created.`);
    if (options.output) console.log(`  AGT document: ${options.output}`);
    if (options.report) console.log(`  report:       ${options.report}`);
  }
}
