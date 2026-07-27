import type { EvaluateParams, EvaluationResult, EvidenceRecord } from "./types.js";

export interface SpctreClientOptions {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  fetch?: typeof globalThis.fetch;
}

export class SpctreClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: SpctreClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeout = options.timeout;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async ingestEvidence(record: EvidenceRecord): Promise<void> {
    await this.post("/evidence", record);
  }

  async evaluate(params: EvaluateParams): Promise<EvaluationResult> {
    const body = await this.post("/evaluate", params);
    return normalizeEvaluationResult(body);
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseText = await response.text();
      const responseBody = responseText ? JSON.parse(responseText) as unknown : {};

      if (!response.ok) {
        throw new Error(`Spctre request failed with HTTP ${response.status}: ${responseText || response.statusText}`);
      }

      return responseBody;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function normalizeEvaluationResult(body: unknown): EvaluationResult {
  if (!body || typeof body !== "object") {
    throw new Error("Spctre evaluate returned a non-object response.");
  }

  const response = body as Record<string, unknown>;
  const result = isRecord(response.result) ? response.result : response;
  const status = result.status;
  const reason = result.reason;

  if (!isRuntimeDecisionStatus(status) || typeof reason !== "string") {
    throw new Error("Spctre evaluate response is missing result.status or result.reason.");
  }

  return {
    status,
    reason,
    matchedRefs: Array.isArray(result.matchedRefs) ? result.matchedRefs.filter((item): item is string => typeof item === "string") : undefined,
    trace: Array.isArray(result.trace) ? result.trace as EvaluationResult["trace"] : undefined,
    ruleCount: typeof result.ruleCount === "number" ? result.ruleCount : undefined,
    evaluatedAt: typeof result.evaluatedAt === "string" ? result.evaluatedAt : undefined,
    artifactHash: typeof response.artifactHash === "string" ? response.artifactHash : undefined,
    branchId: typeof response.branchId === "string" ? response.branchId : undefined,
    revisionId: typeof response.revisionId === "string" ? response.revisionId : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRuntimeDecisionStatus(value: unknown): value is EvaluationResult["status"] {
  return value === "ALLOW" || value === "DENY" || value === "WARN" || value === "ESCALATE";
}
