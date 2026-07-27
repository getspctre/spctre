import { z } from "zod";
import { RuntimeStackSchema } from "./evidence";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const OptionalTrimmedStringSchema = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional();

export const AdapterDeclarationSchema = z.object({
  stack: RuntimeStackSchema,
  adapterId: z.string().trim().min(1, "adapterId is required."),
  adapterVersion: OptionalTrimmedStringSchema,
  environment: OptionalTrimmedStringSchema,
  supportedConnectors: z
    .array(z.unknown())
    .transform((values) => values.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))
    .refine((values) => values.length > 0, "supportedConnectors must include at least one connector."),
  capabilities: z.preprocess(
    (value) => (isRecord(value) ? value : {}),
    z.record(z.string(), z.unknown()).default({})
  ),
  registeredBy: z
    .string()
    .trim()
    .transform((value) => value || "api")
    .optional()
    .default("api"),
});

export type AdapterDeclarationInput = z.infer<typeof AdapterDeclarationSchema>;
