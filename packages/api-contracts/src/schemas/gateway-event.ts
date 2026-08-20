import { z } from "zod";

/** Stable identifier for the normalized gateway event public contract. */
export const GATEWAY_EVENT_V1_SCHEMA_ID = "spctre.gateway.event.v1";

/**
 * Normalized event emitted by a supported LLM gateway.
 *
 * This is distinct from provider webhook payloads: `rawEvent` retains the
 * provider-specific input while the remaining fields are normalized for Spctre.
 * TypeScript validation gates web ingest requests. On delegated requests, the Go
 * worker independently normalizes raw payloads without runtime contract validation:
 * it truncates numeric values instead of rounding and does not clamp negatives.
 * Worker-written records are therefore not guaranteed to conform to this contract;
 * it also does not support `notion`. Schema emission will close this gap.
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
