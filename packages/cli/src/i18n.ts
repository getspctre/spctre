import type { SpctreCliConfig } from "./config";

export const supportedLocales = ["en", "ja", "de", "fr"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
export type DiagnosticVariables = Record<string, string | number | boolean | null | undefined>;

export type CliDiagnosticKey =
  | "diagnostics.policyFileNotFound"
  | "diagnostics.couldNotReadPolicyFile"
  | "diagnostics.unknownConnector"
  | "diagnostics.unknownAction"
  | "diagnostics.deadRule"
  | "diagnostics.conflictShadow"
  | "diagnostics.noIssues";

const catalogs: Record<SupportedLocale, Record<CliDiagnosticKey, string>> = {
  en: {
    "diagnostics.policyFileNotFound": "Policy file not found: {filePath}",
    "diagnostics.couldNotReadPolicyFile": "Could not read {filePath}: {error}",
    "diagnostics.unknownConnector": 'connector "{connector}" not found in pack catalog{suggestion}',
    "diagnostics.unknownAction":
      'action "{action}" not found for connector "{connector}" (known: {known})',
    "diagnostics.deadRule":
      'rule "{ruleId}" references only unknown connectors ({connectors}) - rule can never fire',
    "diagnostics.conflictShadow":
      "rule:{ruleId} shadowed by org baseline rule:{denyRuleId} (immutable, higher precedence)",
    "diagnostics.noIssues": "{filePath}  {ruleCount} rules  no issues found",
  },
  ja: {
    "diagnostics.policyFileNotFound": "ポリシーファイルが見つかりません: {filePath}",
    "diagnostics.couldNotReadPolicyFile": "{filePath} を読み取れません: {error}",
    "diagnostics.unknownConnector":
      'コネクタ "{connector}" はパックカタログにありません{suggestion}',
    "diagnostics.unknownAction":
      'アクション "{action}" はコネクタ "{connector}" にありません (既知: {known})',
    "diagnostics.deadRule":
      'ルール "{ruleId}" は不明なコネクタのみを参照しています ({connectors}) - このルールは発火しません',
    "diagnostics.conflictShadow":
      "rule:{ruleId} は組織ベースライン rule:{denyRuleId} によってシャドーされています (immutable, higher precedence)",
    "diagnostics.noIssues": "{filePath}  {ruleCount} ルール  問題はありません",
  },
  de: {
    "diagnostics.policyFileNotFound": "Richtliniendatei nicht gefunden: {filePath}",
    "diagnostics.couldNotReadPolicyFile": "{filePath} konnte nicht gelesen werden: {error}",
    "diagnostics.unknownConnector":
      'Connector "{connector}" wurde im Pack-Katalog nicht gefunden{suggestion}',
    "diagnostics.unknownAction":
      'Aktion "{action}" wurde fuer Connector "{connector}" nicht gefunden (bekannt: {known})',
    "diagnostics.deadRule":
      'Regel "{ruleId}" verweist nur auf unbekannte Connectors ({connectors}) - Regel kann nie ausloesen',
    "diagnostics.conflictShadow":
      "rule:{ruleId} wird durch Organisations-Baseline rule:{denyRuleId} verdeckt (immutable, higher precedence)",
    "diagnostics.noIssues": "{filePath}  {ruleCount} Regeln  keine Probleme gefunden",
  },
  fr: {
    "diagnostics.policyFileNotFound": "Fichier de politique introuvable : {filePath}",
    "diagnostics.couldNotReadPolicyFile": "Impossible de lire {filePath} : {error}",
    "diagnostics.unknownConnector":
      'connecteur "{connector}" introuvable dans le catalogue de packs{suggestion}',
    "diagnostics.unknownAction":
      'action "{action}" introuvable pour le connecteur "{connector}" (connues : {known})',
    "diagnostics.deadRule":
      'la regle "{ruleId}" ne reference que des connecteurs inconnus ({connectors}) - elle ne peut jamais se declencher',
    "diagnostics.conflictShadow":
      "rule:{ruleId} est masquee par la regle de base organisationnelle rule:{denyRuleId} (immutable, higher precedence)",
    "diagnostics.noIssues": "{filePath}  {ruleCount} regles  aucun probleme trouve",
  },
};

export function normalizeLocale(locale: string | null | undefined): SupportedLocale {
  if (!locale) return "en";
  const candidate = locale.replace("_", "-").split("-")[0]?.toLowerCase();
  return supportedLocales.includes(candidate as SupportedLocale)
    ? (candidate as SupportedLocale)
    : "en";
}

export function isSupportedLocaleInput(locale: string | null | undefined): boolean {
  if (!locale) return false;
  const candidate = locale.replace("_", "-").split("-")[0]?.toLowerCase();
  return supportedLocales.includes(candidate as SupportedLocale);
}

export function detectCliLocale(config?: Pick<SpctreCliConfig, "locale"> | null): SupportedLocale {
  return normalizeLocale(
    config?.locale ?? process.env.LC_ALL ?? process.env.LC_MESSAGES ?? process.env.LANG ?? "en",
  );
}

export class L10nManager {
  readonly locale: SupportedLocale;

  constructor(locale: string | null | undefined) {
    this.locale = normalizeLocale(locale);
  }

  static fromConfig(config?: Pick<SpctreCliConfig, "locale"> | null): L10nManager {
    return new L10nManager(detectCliLocale(config));
  }

  format(key: CliDiagnosticKey, variables: DiagnosticVariables = {}): string {
    const template = catalogs[this.locale][key] ?? catalogs.en[key] ?? key;
    return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
      const value = variables[name];
      return value === null || value === undefined ? match : String(value);
    });
  }
}
