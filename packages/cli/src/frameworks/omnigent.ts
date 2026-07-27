import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { SpctreCliConfig } from "../config";

const SPCTRE_DIR = ".spctre";
const POLICY_MODULE_FILENAME = "spctre_policy.py";
const MANIFEST_FILENAME = "governance-manifest-omnigent.json";
const AUDIT_NOTE_FILENAME = "GOVERNANCE.md";

export function writeOmnigentAdapter(config: SpctreCliConfig): { adapterPath: string; launchHint: string } {
  const spctreDir = path.resolve(process.cwd(), SPCTRE_DIR);
  fs.mkdirSync(spctreDir, { recursive: true });

  const policyPath = path.join(spctreDir, POLICY_MODULE_FILENAME);
  const manifestPath = path.join(spctreDir, MANIFEST_FILENAME);
  const auditNotePath = path.join(spctreDir, AUDIT_NOTE_FILENAME);

  const pythonSource = renderTemplate(config);
  const manifest = buildManifest(config, pythonSource);

  fs.writeFileSync(policyPath, pythonSource, "utf8");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(auditNotePath, renderAuditNote(), "utf8");

  fs.chmodSync(spctreDir, 0o700);
  fs.chmodSync(policyPath, 0o600);
  fs.chmodSync(manifestPath, 0o600);
  fs.chmodSync(auditNotePath, 0o600);

  const launchHint = `PYTHONPATH=./${SPCTRE_DIR}:$PYTHONPATH omnigent server --config server_config.yaml`;
  return { adapterPath: policyPath, launchHint };
}

function renderTemplate(config: SpctreCliConfig): string {
  let source = fs.readFileSync(path.join(__dirname, "templates", "omnigent.py"), "utf8");
  const substitutions: Record<string, string> = {
    FRAMEWORK: "omnigent",
    CONTROL_PLANE_URL: config.controlPlaneUrl,
    TOKEN: config.token,
    TENANT_ID: config.tenantId,
    WORKSPACE_ID: config.workspaceId,
    AGENT_ID: config.agentId,
    ENVIRONMENT: config.environment,
    ARTIFACT_HASH: config.artifactHash,
    POLICY_CONTEXT_JSON: JSON.stringify(config.policyContext ?? []),
  };
  for (const [name, value] of Object.entries(substitutions)) {
    source = source.replaceAll(`"__SPCTRE_${name}__"`, JSON.stringify(value));
    source = source.replaceAll(`__SPCTRE_${name}__`, value);
  }
  return source;
}

function buildManifest(config: SpctreCliConfig, pythonSource: string) {
  return {
    schemaVersion: 1,
    generatedBy: "spctre watch --framework",
    framework: "omnigent",
    runtimePatching: false,
    patchTargets: [],
    policyModuleFile: `${SPCTRE_DIR}/${POLICY_MODULE_FILENAME}`,
    launchCommand: `PYTHONPATH=./${SPCTRE_DIR}:$PYTHONPATH omnigent server --config server_config.yaml`,
    verificationCommand: "spctre verify-env --framework omnigent",
    registrationInstructions: [
      "Add .spctre to PYTHONPATH before starting Omnigent.",
      "Set SPCTRE_API_TOKEN or SPCTRE_KEY in the Omnigent server environment.",
      "In server_config.yaml, add 'spctre_policy' to policy_modules.",
      "Under policies, register a handler with type: function, handler: spctre_policy.spctre_policy.",
    ],
    controlPlaneUrl: config.controlPlaneUrl,
    workspaceId: config.workspaceId,
    agentId: config.agentId,
    environment: config.environment,
    artifactHash: config.artifactHash,
    files: {
      policySha256: sha256(pythonSource),
    },
    auditNotes: [
      "Omnigent uses native policy modules; no runtime monkey-patching is applied.",
      "The spctre_policy factory function delegates governed tool-call decisions to the Spctre evaluate endpoint.",
      "Unhandled or non-tool Omnigent policy events return None so other Omnigent policies can decide.",
      "WARN decisions return Omnigent ALLOW and emit WARN evidence.",
      "ESCALATE decisions map to Omnigent ASK and emit ESCALATE evidence.",
      "spctre verify-env --framework omnigent verifies the policy module file hash and imports the callable.",
    ],
  };
}

function renderAuditNote(): string {
  return `# Spctre Governance Runtime — Omnigent

This directory contains the generated Spctre policy module for Omnigent.

Unlike other framework adapters, Omnigent uses a native policy module system — no runtime
monkey-patching is applied. The \`spctre_policy.py\` module exports a policy factory function
that Omnigent calls before each governed tool execution.

## Registration

Add \`.spctre\` to your PYTHONPATH and register in \`server_config.yaml\`:

\`\`\`yaml
policy_modules:
  - spctre_policy

policies:
  spctre_guard:
    type: function
    handler: spctre_policy.spctre_policy
    factory_params:
      decision_endpoint: "/api/v1/evaluate"
      outage_policy: "fail-open"
\`\`\`

Then start the server:

    PYTHONPATH=./.spctre:$PYTHONPATH SPCTRE_API_TOKEN=... omnigent server --config server_config.yaml

## Audit checklist

- Review \`governance-manifest-omnigent.json\` for the policy file hash and registration instructions.
- Review \`spctre_policy.py\` for event normalization and the configured Spctre decision endpoint.
- Run: \`spctre verify-env --framework omnigent\`
- Confirm \`governance_active\` evidence appears in the control plane after server startup.
- Confirm the policy module is listed under \`policy_modules\` in \`server_config.yaml\`.
- Confirm \`SPCTRE_API_TOKEN\` or \`SPCTRE_KEY\` is supplied by the Omnigent server environment.
`;
}

function sha256(source: string): string {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}
