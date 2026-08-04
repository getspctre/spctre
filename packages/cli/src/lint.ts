import * as fs from "node:fs";
import * as path from "node:path";
import { parseAgtPolicyDocument, POLICY_PACKS } from "@spctre/policy-schema";
import type { PolicyRuleSummary } from "@spctre/policy-schema";
import { readConfig } from "./config";
import { refreshIfNeeded } from "./refresh";
import { L10nManager, type CliDiagnosticKey, type DiagnosticVariables } from "./i18n";

interface LintDiagnostic {
  severity: "error" | "warn";
  code?: string;
  messageKey?: CliDiagnosticKey;
  meta?: DiagnosticVariables;
  ruleId?: string;
  message: string;
}

export interface LintResult {
  file: string;
  parseErrors: string[];
  diagnostics: LintDiagnostic[];
  ruleCount: number;
}

// Build connector → known actions map from the local pack catalog.
function buildCatalogMap(): { connectors: Set<string>; actions: Map<string, Set<string>> } {
  const connectors = new Set<string>();
  const actions = new Map<string, Set<string>>();

  for (const pack of POLICY_PACKS) {
    connectors.add(pack.connector);
    const packActions = actions.get(pack.connector) ?? new Set<string>();
    for (const rule of pack.rules) {
      for (const a of rule.actions) packActions.add(a);
      for (const c of rule.connectors) {
        connectors.add(c);
        const existing = actions.get(c) ?? new Set<string>();
        for (const a of rule.actions) existing.add(a);
        actions.set(c, existing);
      }
    }
    actions.set(pack.connector, packActions);
  }

  return { connectors, actions };
}

function checkCatalog(
  rules: PolicyRuleSummary[],
  catalog: { connectors: Set<string>; actions: Map<string, Set<string>> },
): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];

  for (const rule of rules) {
    for (const connector of rule.connectors) {
      if (!catalog.connectors.has(connector)) {
        // Suggest closest match by simple prefix check
        const candidates = [...catalog.connectors].filter(
          (c) => c.startsWith(connector.slice(0, 3)) || connector.startsWith(c.slice(0, 3)),
        );
        const suggestion = candidates.length > 0 ? `  did you mean "${candidates[0]}"?` : "";
        diagnostics.push({
          severity: "warn",
          code: "UNKNOWN_CONNECTOR",
          messageKey: "diagnostics.unknownConnector",
          meta: { connector, suggestion },
          ruleId: rule.stableRuleId,
          message: `connector "${connector}" not found in pack catalog${suggestion}`,
        });
        continue;
      }

      // Check actions against known actions for this connector
      const knownActions = catalog.actions.get(connector);
      if (knownActions && rule.actions.length > 0) {
        for (const action of rule.actions) {
          if (!knownActions.has(action)) {
            const known = [...knownActions].slice(0, 5).join(", ");
            diagnostics.push({
              severity: "warn",
              code: "UNKNOWN_ACTION",
              messageKey: "diagnostics.unknownAction",
              meta: { action, connector, known },
              ruleId: rule.stableRuleId,
              message: `action "${action}" not found for connector "${connector}" (known: ${known})`,
            });
          }
        }
      }
    }
  }

  return diagnostics;
}

function checkDeadRules(
  rules: PolicyRuleSummary[],
  catalog: { connectors: Set<string>; actions: Map<string, Set<string>> },
): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];

  for (const rule of rules) {
    if (rule.connectors.length === 0 && rule.actions.length === 0) continue; // wildcard — always active

    // A rule is dead if all its connectors are unknown (can never match any adapter)
    if (rule.connectors.length > 0 && rule.connectors.every((c) => !catalog.connectors.has(c))) {
      diagnostics.push({
        severity: "warn",
        code: "DEAD_RULE",
        messageKey: "diagnostics.deadRule",
        meta: { ruleId: rule.stableRuleId, connectors: rule.connectors.join(", ") },
        ruleId: rule.stableRuleId,
        message: `rule "${rule.stableRuleId}" references only unknown connectors (${rule.connectors.join(", ")}) - rule can never fire`,
      });
    }
  }

  return diagnostics;
}

function checkConflictShadows(rules: PolicyRuleSummary[]): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const immutableDenies = rules.filter((r) => r.immutable && r.effect === "DENY");

  for (const rule of rules) {
    if (rule.immutable) continue;

    for (const denyRule of immutableDenies) {
      if (isShadowedBy(rule, denyRule)) {
        diagnostics.push({
          severity: "warn",
          code: "CONFLICT_SHADOW",
          messageKey: "diagnostics.conflictShadow",
          meta: { ruleId: rule.stableRuleId, denyRuleId: denyRule.stableRuleId },
          ruleId: rule.stableRuleId,
          message: `rule:${rule.stableRuleId} shadowed by org baseline rule:${denyRule.stableRuleId} (immutable, higher precedence)`,
        });
        break; // one shadow warning per rule is enough
      }
    }
  }

  return diagnostics;
}

function isShadowedBy(rule: PolicyRuleSummary, denyRule: PolicyRuleSummary): boolean {
  const connectorCovered =
    denyRule.connectors.length === 0 ||
    (rule.connectors.length > 0 && rule.connectors.every((c) => denyRule.connectors.includes(c)));

  const actionCovered =
    denyRule.actions.length === 0 ||
    (rule.actions.length > 0 && rule.actions.every((a) => denyRule.actions.includes(a)));

  return connectorCovered && actionCovered;
}

function fetchCatalogFromApi(
  _controlPlaneUrl: string,
  _token: string,
): Promise<{ connectors: Set<string>; actions: Map<string, Set<string>> } | null> {
  // Placeholder for future server-side catalog fetch. Returns null to fall back to local catalog.
  return Promise.resolve(null);
}

/**
 * Run lint analysis on a policy file and return the result without any
 * printing or process.exit — useful for composing into spctre check.
 */
export async function lintFile(
  filePath: string,
  options: { offline?: boolean; url?: string; token?: string } = {},
): Promise<LintResult> {
  if (!fs.existsSync(filePath)) {
    return {
      file: filePath,
      parseErrors: [`Policy file not found: ${filePath}`],
      diagnostics: [],
      ruleCount: 0,
    };
  }

  let document: string;
  try {
    document = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    return {
      file: filePath,
      parseErrors: [`Could not read ${filePath}: ${String(err)}`],
      diagnostics: [],
      ruleCount: 0,
    };
  }

  const importResult = parseAgtPolicyDocument({ document, sourcePath: filePath });
  const result: LintResult = {
    file: filePath,
    parseErrors: importResult.diagnostics
      .filter((d) => d.severity === "ERROR")
      .map((d) => d.message),
    diagnostics: [],
    ruleCount: importResult.rules.length,
  };

  if (result.parseErrors.length > 0) return result;

  for (const d of importResult.diagnostics.filter((d) => d.severity === "WARNING")) {
    result.diagnostics.push({ severity: "warn", message: d.message, ruleId: d.ruleId });
  }

  if (!options.offline) {
    const remoteCatalog = options.url
      ? await fetchCatalogFromApi(options.url, options.token ?? "")
      : null;
    const catalog = remoteCatalog ?? buildCatalogMap();
    result.diagnostics.push(...checkCatalog(importResult.rules, catalog));
    result.diagnostics.push(...checkDeadRules(importResult.rules, catalog));
  }

  result.diagnostics.push(...checkConflictShadows(importResult.rules));
  return result;
}

export async function lint(
  policyArg: string | undefined,
  options: { offline: boolean; format?: string; strict: boolean; url?: string },
): Promise<void> {
  let config = readConfig();
  if (config && !options.url) config = await refreshIfNeeded(config);
  const controlPlaneUrl = options.url ?? config?.controlPlaneUrl ?? "";

  const filePath = policyArg
    ? path.resolve(process.cwd(), policyArg)
    : path.resolve(process.cwd(), config?.bundlePath ?? "spctre-policy.json");

  if (!fs.existsSync(filePath)) {
    console.error(`Error: Policy file not found: ${filePath}`);
    process.exit(1);
  }

  const result = await lintFile(filePath, {
    offline: options.offline,
    url: controlPlaneUrl || undefined,
    token: config?.token,
  });

  if (result.parseErrors.length > 0) {
    printResult(result, options.format, L10nManager.fromConfig(config));
    process.exit(1);
  }

  printResult(result, options.format, L10nManager.fromConfig(config));

  const hasErrors =
    result.parseErrors.length > 0 || (options.strict && result.diagnostics.length > 0);
  if (hasErrors) process.exit(1);
}

function printResult(
  result: LintResult,
  format?: string,
  l10n = L10nManager.fromConfig(readConfig()),
): void {
  if (format === "json") {
    console.log(
      JSON.stringify(
        {
          file: result.file,
          ruleCount: result.ruleCount,
          parseErrors: result.parseErrors,
          diagnostics: result.diagnostics,
          ok: result.parseErrors.length === 0 && result.diagnostics.length === 0,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (result.parseErrors.length > 0) {
    for (const msg of result.parseErrors) {
      console.error(`error  ${msg}`);
    }
    return;
  }

  if (result.diagnostics.length === 0) {
    console.log(
      l10n.format("diagnostics.noIssues", { filePath: result.file, ruleCount: result.ruleCount }),
    );
    return;
  }

  for (const d of result.diagnostics) {
    const ruleLabel = d.ruleId ? `  rule:${d.ruleId}  ` : "  ";
    const message = d.messageKey ? l10n.format(d.messageKey, d.meta) : d.message;
    console.log(`${d.severity}${ruleLabel}${message}`);
  }
  console.log(`\n${result.ruleCount} rules, ${result.diagnostics.length} issue(s)`);
}
