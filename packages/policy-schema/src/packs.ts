import type { PolicyRuleSummary, PolicyPack, PolicyPackChangelogEntry, PolicyPackMetadata } from "./types";

export type { PolicyPack, PolicyPackChangelogEntry, PolicyPackMetadata };

function parseSemver(version: string): [number, number, number] {
  const [major = "0", minor = "0", patch = "0"] = version.split(".");
  const toInt = (value: string) => {
    const normalized = value.replace(/[^0-9].*$/, "");
    const parsed = Number.parseInt(normalized || "0", 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [toInt(major), toInt(minor), toInt(patch)];
}

export function comparePackVersions(left: string, right: string): number {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }

  return 0;
}

export function getPackMetadata(pack: PolicyPack): PolicyPackMetadata {
  const metadata = pack.metadata ?? {};

  const version =
    typeof metadata.version === "string" && metadata.version.trim()
      ? metadata.version.trim()
      : "1.0.0";

  const changelog = Array.isArray(metadata.changelog)
    ? metadata.changelog
        .filter((entry): entry is Record<string, unknown> =>
          !!entry && typeof entry === "object" && !Array.isArray(entry)
        )
        .map((entry) => ({
          version:
            typeof entry.version === "string" && entry.version.trim()
              ? entry.version.trim()
              : version,
          date:
            typeof entry.date === "string" && entry.date.trim()
              ? entry.date.trim()
              : "1970-01-01",
          summary:
            typeof entry.summary === "string" && entry.summary.trim()
              ? entry.summary.trim()
              : "Pack update",
        }))
    : [];

  return {
    name: typeof metadata.name === "string" ? metadata.name : pack.name,
    version,
    connector: typeof metadata.connector === "string" ? metadata.connector : pack.connector,
    author: typeof metadata.author === "string" ? metadata.author : "spctre",
    owner: typeof metadata.owner === "string" ? metadata.owner : "spctre-pack-security",
    riskLevel: pack.riskLevel,
    riskTags: Array.isArray(metadata.riskTags)
      ? metadata.riskTags.filter((tag): tag is string => typeof tag === "string")
      : pack.tags.slice(0, 4),
    generated: Boolean(metadata.generated),
    category: typeof metadata.category === "string" ? metadata.category : "connector governance",
    compatibilityTargets: Array.isArray(metadata.compatibilityTargets)
      ? metadata.compatibilityTargets.filter((target): target is string => typeof target === "string")
      : ["AGT_PREVIEW"],
    reviewRoles: Array.isArray(metadata.reviewRoles)
      ? metadata.reviewRoles.filter((role): role is string => typeof role === "string")
      : ["SECURITY", "COMPLIANCE"],
    minimumApprovals:
      typeof metadata.minimumApprovals === "number" && metadata.minimumApprovals > 0
        ? Math.floor(metadata.minimumApprovals)
        : 2,
    changelog,
  };
}

export function getPackVersion(pack: PolicyPack): string {
  return getPackMetadata(pack).version;
}

export function packToDocument(pack: PolicyPack): string {
  return JSON.stringify(
    {
      // pack.parameters is nested under metadata (rather than a new top-level
      // document field) so it round-trips through parseAgtPolicyDocument's
      // existing generic metadata passthrough without additional parsing.
      metadata: pack.parameters ? { ...pack.metadata, parameters: pack.parameters } : pack.metadata,
      rules: pack.rules.map((r) => {
        // Serialize EVERY authored rule field, not just the seven structural
        // ones plus the three typed collections. An earlier version enumerated a
        // fixed subset, so a pack rule carrying priority, conditions, or any
        // extended targeting field (runtimeStacks, trustLevels, ...) had that
        // field silently dropped at install — a provenance hole at the
        // pack→document boundary.
        //
        // Field ORDER is deliberate and load-bearing: stable_rule_id first, then
        // the six structural fields in their historical order, then any newly
        // preserved fields, then the trailing typed collections. A rule that
        // carries only the previously-serialized fields therefore serializes
        // BYTE-IDENTICALLY to the prior serializer (and hashes identically), so
        // installing a canonical pack does not churn its source_hash.
        const {
          stableRuleId,
          title,
          effect,
          domains,
          connectors,
          actions,
          immutable,
          semanticChecks,
          parameterConstraints,
          controlMappings,
          dynamicConditions,
          conditions,
          ...extra
        } = r;

        // dynamicConditions is a parser-DERIVED projection: parseAgtPolicyDocument
        // owns that key and rebuilds it from the AGT-native source each condition
        // was classified from (a native field like time_window, or an entry in
        // `conditions`). Emitting the derived array verbatim would be silently
        // dropped on reparse — so re-emit the SOURCE (its required
        // originalCondition) instead: native-field sources become native rule
        // fields, condition sources are folded into `conditions`. This lets a
        // pack rule's dynamic conditions survive pack -> document -> parse.
        const nativeFields: Record<string, unknown> = {};
        const mergedConditions: Record<string, unknown>[] = Array.isArray(conditions) ? [...conditions] : [];
        for (const dc of Array.isArray(dynamicConditions) ? dynamicConditions : []) {
          const original = dc?.originalCondition;
          if (!original || typeof original !== "object" || Array.isArray(original)) continue;
          if (dc.source === "AGT_NATIVE_FIELD") {
            Object.assign(nativeFields, original);
          } else if (!mergedConditions.some((existing) => JSON.stringify(existing) === JSON.stringify(original))) {
            mergedConditions.push(original as Record<string, unknown>);
          }
        }

        return {
          stable_rule_id: stableRuleId,
          title,
          effect,
          domains,
          connectors,
          actions,
          immutable,
          ...nativeFields,
          ...(mergedConditions.length ? { conditions: mergedConditions } : {}),
          ...extra,
          ...(semanticChecks ? { semantic_checks: semanticChecks } : {}),
          ...(parameterConstraints ? { parameter_constraints: parameterConstraints } : {}),
          ...(controlMappings ? { control_mappings: controlMappings } : {}),
        };
      }),
    },
    null,
    2
  );
}

export {
  CANONICAL_PACK_CONNECTORS,
  getPackCatalogTier,
  POLICY_PACKS,
} from "./pack-definitions";
export type { PackCatalogTier } from "./pack-definitions";
