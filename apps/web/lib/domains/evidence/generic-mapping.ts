import {
  CanonicalEnforcementDecisionSchema,
  EvidenceFieldMappingSchema,
  type CanonicalEnforcementDecision,
  type EvidenceFieldMapping,
} from "@spctre/api-contracts";
import { createHash } from "node:crypto";
import { isRecord } from "@/lib/records";

export type NormalizedGenericEvidence = {
  sourceEventId?: string;
  occurredAt: string;
  action: string;
  principalId?: string;
  agentExternalId?: string;
  targetResource?: string;
  policyReference?: string;
  environment?: string;
  enforcementDecision: CanonicalEnforcementDecision;
  sourceAttributes: Record<string, unknown>;
};

export function validateEvidenceMapping(value: unknown): EvidenceFieldMapping {
  return EvidenceFieldMappingSchema.parse(value);
}

export function normalizeGenericEvidence(
  payload: Record<string, unknown>,
  mappingInput: unknown,
): NormalizedGenericEvidence {
  const mapping = validateEvidenceMapping(mappingInput);
  const occurredAt = requiredString(resolve(mapping.occurred_at, payload), "occurred_at");
  if (Number.isNaN(Date.parse(occurredAt)))
    throw new Error("occurred_at must resolve to an ISO-8601 timestamp.");
  const action = requiredString(resolve(mapping.action, payload), "action");
  const decision = optionalString(resolve(mapping.enforcement_decision, payload));
  const enforcementDecision = CanonicalEnforcementDecisionSchema.safeParse(
    decision?.toLowerCase() ?? "observe",
  );
  if (!enforcementDecision.success)
    throw new Error("enforcement_decision must resolve to allow, deny, escalate, or observe.");

  return {
    sourceEventId: optionalString(resolve(mapping.source_event_id, payload)),
    occurredAt: new Date(occurredAt).toISOString(),
    action,
    principalId: optionalString(resolve(mapping.principal_id, payload)),
    agentExternalId: optionalString(resolve(mapping.agent_external_id, payload)),
    targetResource: optionalString(resolve(mapping.target_resource, payload)),
    policyReference: optionalString(resolve(mapping.policy_reference, payload)),
    environment: optionalString(resolve(mapping.environment, payload)),
    enforcementDecision: enforcementDecision.data,
    // Keep the canonical event self-contained for event reads. The immutable
    // source receipt also stores this payload separately for provenance.
    sourceAttributes: payload,
  };
}

export function sourceContentHash(payload: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(payload)).digest("hex")}`;
}

export function sourceIdempotencyKey(sourceEventId: string | undefined, payload: unknown): string {
  return sourceEventId ? `source:${sourceEventId}` : `hash:${sourceContentHash(payload)}`;
}

function resolve(
  spec: EvidenceFieldMapping[keyof EvidenceFieldMapping] | undefined,
  value: unknown,
): unknown {
  if (!spec) return undefined;
  if (typeof spec === "string") return readPath(value, spec);
  const resolved = spec.path ? readPath(value, spec.path) : undefined;
  const base = resolved ?? spec.default;
  if (base === undefined || !spec.transform) return base;
  if (spec.transform === "string") return String(base);
  if (spec.transform === "number") return Number(base);
  if (typeof base !== "string")
    throw new Error(`${spec.transform} transform requires a string value.`);
  return spec.transform === "lowercase" ? base.toLowerCase() : base.toUpperCase();
}

function readPath(value: unknown, path: string): unknown {
  const tokens = path.match(/\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\]/g) ?? [];
  return tokens.reduce<unknown>((current, token) => {
    if (current === undefined || current === null) return undefined;
    if (token.startsWith(".")) return isRecord(current) ? current[token.slice(1)] : undefined;
    return Array.isArray(current) ? current[Number(token.slice(1, -1))] : undefined;
  }, value);
}

function requiredString(value: unknown, field: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(`${field} is required by the active mapping.`);
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
