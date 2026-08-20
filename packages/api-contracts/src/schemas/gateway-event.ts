import { z } from "zod";

/** Stable identifier for the normalized gateway event public contract. */
export const GATEWAY_EVENT_V1_SCHEMA_ID = "spctre.gateway.event.v1";

/**
 * Normalized event emitted by a supported LLM gateway.
 *
 * This is distinct from provider webhook payloads: `rawEvent` retains the
 * provider-specific input while the remaining fields are normalized for Spctre.
 * The TypeScript gateway ingest path is authoritative for enforcement. The Go
 * worker currently has a separately normalized path (and does not support
 * `notion`); aligning its runtime validation is a follow-up to schema emission.
 */
export const GatewayEventV1Schema = z
  .object({
    provider: z.enum(["portkey", "helicone", "litellm", "notion"]),
    gatewayEventId: z.string().min(1),
    model: z.string().min(1),
    agentId: z.string().min(1),
    connector: z.string().min(1),
    action: z.string().min(1),
    toolDeclarations: z.array(z.string().min(1)),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative().optional(),
    eventTimestamp: z.string().min(1),
    rawEvent: z.record(z.string(), z.unknown()),
  })
  .meta({ id: GATEWAY_EVENT_V1_SCHEMA_ID });

export type GatewayEventV1 = z.infer<typeof GatewayEventV1Schema>;
