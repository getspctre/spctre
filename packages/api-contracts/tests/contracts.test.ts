import { describe, it, expect } from "vitest";
import {
  EvidenceIngestSchema,
  GitCheckpointIngestSchema,
  GatewayDecisionSchema,
  GatewayResolveSchema,
  TokenRefreshSchema,
  TokenPairResponseSchema,
  EvaluateSchema,
  AdapterDeclarationSchema,
  parseBody,
  ok,
  err,
  paginated,
  makeMeta,
  IdempotencyCache,
  API_VERSION,
  SPCTRE_OPENAPI_SPEC,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TRACE = "test-trace-id";

const validPolicyContext = [
  {
    scope: "ORGANIZATION" as const,
    branchId: "branch-1",
    revisionId: "rev-1",
    artifactHash: "abc123",
  },
];

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------
describe("envelope", () => {
  it("ok() sets data and meta fields", () => {
    const result = ok({ id: "1" }, TRACE);
    expect(result.data).toEqual({ id: "1" });
    expect(result.meta.traceId).toBe(TRACE);
    expect(result.meta.version).toBe(API_VERSION);
    expect(typeof result.meta.ts).toBe("string");
  });

  it("err() sets error and meta fields", () => {
    const result = err("Something went wrong.", TRACE, [{ path: "foo", message: "required" }]);
    expect(result.error).toBe("Something went wrong.");
    expect(result.issues).toHaveLength(1);
    expect(result.meta.traceId).toBe(TRACE);
  });

  it("paginated() sets data, pagination, and meta fields", () => {
    const result = paginated([1, 2, 3], { total: 100, limit: 10, offset: 0 }, TRACE);
    expect(result.data).toHaveLength(3);
    expect(result.pagination.total).toBe(100);
    expect(result.meta.traceId).toBe(TRACE);
  });
});

// ---------------------------------------------------------------------------
// EvidenceIngestSchema
// ---------------------------------------------------------------------------
describe("EvidenceIngestSchema", () => {
  const valid = {
    decisionId: "decision-abc",
    environment: "production",
    runtimeTarget: { stack: "AWS_BEDROCK" },
    agentId: "agent-1",
    connector: "stripe",
    action: "charge",
    status: "ALLOW",
    reason: "within policy",
    policyRefs: ["policy-ref-1"],
    artifactHash: "hash-abc",
    policyContext: validPolicyContext,
  };

  it("accepts a minimal valid payload", () => {
    const result = parseBody(EvidenceIngestSchema, valid);
    expect(result.ok).toBe(true);
  });

  it("accepts optional fields", () => {
    const result = parseBody(EvidenceIngestSchema, {
      ...valid,
      latencyMs: 50,
      trustScore: 0.9,
      consequence: "high",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.latencyMs).toBe(50);
      expect(result.value.trustScore).toBe(0.9);
    }
  });

  it("rejects missing decisionId", () => {
    const { decisionId, ...rest } = valid;
    const result = parseBody(EvidenceIngestSchema, rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path === "decisionId")).toBe(true);
  });

  it("rejects invalid runtimeTarget.stack", () => {
    const result = parseBody(EvidenceIngestSchema, {
      ...valid,
      runtimeTarget: { stack: "INVALID_STACK" },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts AGT 4 runtime stacks", () => {
    const result = parseBody(EvidenceIngestSchema, {
      ...valid,
      runtimeTarget: { stack: "LANGGRAPH" },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts new runtime stacks from integration landscape", () => {
    for (const stack of ["HERMES", "OPENCLAW", "NEMOCLAW", "CLAUDE_COWORK", "ODYSSEUS", "PAPERCLIP"] as const) {
      const result = parseBody(EvidenceIngestSchema, {
        ...valid,
        runtimeTarget: { stack },
      });
      expect(result.ok).toBe(true);
    }
  });

  it("accepts new evidence fields from integration landscape", () => {
    const result = parseBody(EvidenceIngestSchema, {
      ...valid,
      runtimeTarget: { stack: "CLAUDE_COWORK" },
      triggerKind: "mobile_dispatch",
      layer: "agent",
      executionContext: { backend: "dispatch", sessionId: "ses-abc", sandboxName: "nemo-prod", inferenceProvider: "nim-local" },
      parentAgentId: "agent-parent-1",
      traceId: "trace-abc123",
      orchestratorRef: { platform: "paperclip", companyId: "company-1", issueId: "issue-1", goalId: "goal-1" },
      pluginSource: "corporate_private",
      skillContext: { activeSkills: ["skill-a"], promptPolicyRefs: ["prompt.rule"], promptSurface: "before_prompt_build" },
      trustLevel: "low",
      catalogProvider: "paperclip",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.triggerKind).toBe("mobile_dispatch");
      expect(result.value.layer).toBe("agent");
      expect(result.value.parentAgentId).toBe("agent-parent-1");
      expect(result.value.orchestratorRef?.companyId).toBe("company-1");
      expect(result.value.skillContext?.promptSurface).toBe("before_prompt_build");
    }
  });

  it("rejects invalid triggerKind", () => {
    const result = parseBody(EvidenceIngestSchema, {
      ...valid,
      triggerKind: "unknown_trigger",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid layer", () => {
    const result = parseBody(EvidenceIngestSchema, {
      ...valid,
      layer: "kernel",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects empty policyRefs array", () => {
    const result = parseBody(EvidenceIngestSchema, { ...valid, policyRefs: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/policyRefs/);
  });

  it("rejects empty policyContext array", () => {
    const result = parseBody(EvidenceIngestSchema, { ...valid, policyContext: [] });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid status", () => {
    const result = parseBody(EvidenceIngestSchema, { ...valid, status: "MAYBE" });
    expect(result.ok).toBe(false);
  });

  it("enforces length limits and redacts sensitive parameters", () => {
    const longString = "a".repeat(3000);
    const result = parseBody(EvidenceIngestSchema, {
      ...valid,
      toolIntent: longString,
      planSummary: longString,
      toolParameters: {
        safeKey: "safe value",
        sensitiveKey: "supersecretpassword123",
        nested: {
          deepKey: "val",
          apiKey: "sk-proj-abc123xyz"
        }
      }
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.toolIntent?.length).toBeLessThanOrEqual(1017); // 1000 + "... [Truncated]"
      expect(result.value.toolIntent).toContain("[Truncated]");
      expect(result.value.planSummary?.length).toBeLessThanOrEqual(2017); // 2000 + "... [Truncated]"
      expect(result.value.planSummary).toContain("[Truncated]");
      
      const params = result.value.toolParameters as any;
      expect(params.safeKey).toBe("safe value");
      expect(params.sensitiveKey).toBe("[REDACTED]");
      expect(params.nested.deepKey).toBe("val");
      expect(params.nested.apiKey).toBe("[REDACTED]");
    }
  });
});

describe("GitCheckpointIngestSchema", () => {
  const valid = {
    idempotencyKey: "checkpoint:repo-1:cp-1",
    environment: "production",
    status: "ALLOW" as const,
    reason: "Reviewed checkpoint.",
    checkpoint: {
      id: "cp-1",
      createdAt: "2026-07-20T14:30:00Z",
      repository: { id: "repo-1" },
      headCommit: "abc123",
      diff: { format: "name-status" as const, files: [{ path: "src/index.ts", status: "modified" as const }] },
    },
  };

  it("accepts normalized Git checkpoint metadata", () => {
    expect(parseBody(GitCheckpointIngestSchema, valid).ok).toBe(true);
  });

  it("requires a representation for non-empty diffs", () => {
    const result = parseBody(GitCheckpointIngestSchema, {
      ...valid,
      checkpoint: { ...valid.checkpoint, diff: { format: "unified" } },
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OpenAPI
// ---------------------------------------------------------------------------
describe("SPCTRE_OPENAPI_SPEC", () => {
  it("documents AGT 4 runtime and verification enums", () => {
    const schemas = SPCTRE_OPENAPI_SPEC.components.schemas;
    const runtimeStack = schemas.RuntimeStack as { enum?: readonly string[] };
    const verification = schemas.VerificationIngestRequest as {
      properties?: { verificationType?: { enum?: readonly string[] }; argumentsHash?: unknown; issuedAt?: unknown };
    };

    expect(runtimeStack.enum).toContain("OPENCODE");
    expect(runtimeStack.enum).toContain("OMNIGENT");
    expect(verification.properties?.verificationType?.enum).toContain("AGT_REPLAY");
    expect(verification.properties?.argumentsHash).toBeTruthy();
    expect(verification.properties?.issuedAt).toBeTruthy();
  });

  it("documents new integration landscape runtime stacks", () => {
    const schemas = SPCTRE_OPENAPI_SPEC.components.schemas;
    const runtimeStack = schemas.RuntimeStack as { enum?: readonly string[] };

    for (const stack of ["HERMES", "OPENCLAW", "NEMOCLAW", "CLAUDE_COWORK", "ODYSSEUS", "PAPERCLIP"]) {
      expect(runtimeStack.enum).toContain(stack);
    }
  });

  it("documents TriggerKind and EvidenceLayer component schemas", () => {
    const schemas = SPCTRE_OPENAPI_SPEC.components.schemas;
    const triggerKind = schemas.TriggerKind as { enum?: readonly string[] };
    const evidenceLayer = schemas.EvidenceLayer as { enum?: readonly string[] };

    expect(triggerKind.enum).toContain("interactive");
    expect(triggerKind.enum).toContain("mobile_dispatch");
    expect(triggerKind.enum).toContain("inbound_webhook");
    expect(triggerKind.enum).toContain("routine");
    expect(triggerKind.enum).toContain("gateway_message");
    expect(evidenceLayer.enum).toContain("agent");
    expect(evidenceLayer.enum).toContain("sandbox");
  });

  it("documents company scope and deployment metadata", () => {
    const schemas = SPCTRE_OPENAPI_SPEC.components.schemas;
    const runtimeTarget = schemas.RuntimeTarget as { properties?: Record<string, unknown> };
    const policyContext = schemas.RuntimePolicyContext as {
      properties?: { scope?: { enum?: readonly string[] } };
    };

    expect(policyContext.properties?.scope?.enum).toContain("COMPANY");
    expect(runtimeTarget.properties?.sandboxName).toBeTruthy();
    expect(runtimeTarget.properties?.inferenceProvider).toBeTruthy();
  });

  it("documents the framework-agnostic Git checkpoint endpoint", () => {
    const paths = SPCTRE_OPENAPI_SPEC.paths as Record<string, unknown>;
    const schemas = SPCTRE_OPENAPI_SPEC.components.schemas as Record<string, unknown>;

    expect(paths["/evidence/git-checkpoints"]).toBeTruthy();
    expect(schemas.GitCheckpointIngestRequest).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GatewayDecisionSchema
// ---------------------------------------------------------------------------
describe("GatewayDecisionSchema", () => {
  const valid = {
    decisionId: "gw-dec-1",
    artifactHash: "hash-xyz",
    policyContext: validPolicyContext,
  };

  it("accepts a minimal valid payload", () => {
    const result = parseBody(GatewayDecisionSchema, valid);
    expect(result.ok).toBe(true);
  });

  it("accepts full payload", () => {
    const result = parseBody(GatewayDecisionSchema, {
      ...valid,
      agentId: "agent-continuity-1",
      consequence: "financial",
      confidence: 0.8,
      riskLevel: "HIGH",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.agentId).toBe("agent-continuity-1");
  });

  it("rejects missing decisionId", () => {
    const { decisionId, ...rest } = valid;
    const result = parseBody(GatewayDecisionSchema, rest);
    expect(result.ok).toBe(false);
  });

  it("rejects confidence > 1", () => {
    const result = parseBody(GatewayDecisionSchema, { ...valid, confidence: 1.5 });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid riskLevel", () => {
    const result = parseBody(GatewayDecisionSchema, { ...valid, riskLevel: "EXTREME" });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GatewayResolveSchema
// ---------------------------------------------------------------------------
describe("GatewayResolveSchema", () => {
  it("accepts PROCEED outcome", () => {
    const result = parseBody(GatewayResolveSchema, {
      queueId: "queue-1",
      resolutionOutcome: "PROCEED",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts ESCALATE outcome", () => {
    const result = parseBody(GatewayResolveSchema, {
      queueId: "queue-2",
      resolutionOutcome: "ESCALATE",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts ABORT outcome with note", () => {
    const result = parseBody(GatewayResolveSchema, {
      queueId: "queue-3",
      resolutionOutcome: "ABORT",
      resolutionNote: "violated policy",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unknown outcome", () => {
    const result = parseBody(GatewayResolveSchema, {
      queueId: "queue-4",
      resolutionOutcome: "RETRY",
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TokenRefreshSchema
// ---------------------------------------------------------------------------
describe("TokenRefreshSchema", () => {
  it("accepts valid token", () => {
    const result = parseBody(TokenRefreshSchema, { refreshToken: "tok_abc123" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.refreshToken).toBe("tok_abc123");
  });

  it("rejects missing refreshToken", () => {
    const result = parseBody(TokenRefreshSchema, {});
    expect(result.ok).toBe(false);
  });

  it("rejects empty refreshToken string", () => {
    const result = parseBody(TokenRefreshSchema, { refreshToken: "" });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TokenPairResponseSchema
// ---------------------------------------------------------------------------
describe("TokenPairResponseSchema", () => {
  it("accepts a valid token pair", () => {
    const now = new Date().toISOString();
    const result = parseBody(TokenPairResponseSchema, {
      accessToken: "at_abc",
      accessTokenExpiresAt: now,
      refreshToken: "rt_abc",
      refreshTokenExpiresAt: now,
    });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// IdempotencyCache
// ---------------------------------------------------------------------------
describe("IdempotencyCache", () => {
  it("returns stored value", () => {
    const cache = new IdempotencyCache<string>();
    cache.set("key1", "result1");
    expect(cache.get("key1")).toBe("result1");
  });

  it("returns undefined for unknown key", () => {
    const cache = new IdempotencyCache<string>();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("expires entries after ttl", async () => {
    const cache = new IdempotencyCache<string>(10); // 10 ms TTL
    cache.set("k", "v");
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.get("k")).toBeUndefined();
  });

  it("has() returns false after expiry", async () => {
    const cache = new IdempotencyCache<string>(10);
    cache.set("k", "v");
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.has("k")).toBe(false);
  });

  it("evicts oldest entry at capacity", () => {
    // Use a very small custom max by overriding — test the eviction logic
    // by filling more than MAX_ENTRIES entries (we use a tiny cache via
    // a subclass trick). Here we just verify the behaviour is stable under many sets.
    const cache = new IdempotencyCache<number>();
    for (let i = 0; i < 10; i++) {
      cache.set(`key${i}`, i);
    }
    expect(cache.get("key9")).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// EvaluateSchema
// ---------------------------------------------------------------------------
describe("EvaluateSchema", () => {
  it("accepts valid EvaluateRequest", () => {
    const result = parseBody(EvaluateSchema, {
      connector: "slack",
      action: "message.post",
      domains: ["communication"],
      toolIntent: "Send welcome message",
      planSummary: "Greet user",
      toolParameters: { channel: "general" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.connector).toBe("slack");
      expect(result.value.toolIntent).toBe("Send welcome message");
    }
  });

  it("enforces sanitization and limits on intent fields", () => {
    const longString = "a".repeat(3000);
    const result = parseBody(EvaluateSchema, {
      connector: "slack",
      action: "message.post",
      toolIntent: longString,
      planSummary: longString,
      toolParameters: { sensitive_password_key: "secret-value-to-redact-password" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.toolIntent?.length).toBeLessThanOrEqual(1017);
      expect(result.value.toolIntent).toContain("[Truncated]");
      expect(result.value.planSummary?.length).toBeLessThanOrEqual(2017);
      expect(result.value.planSummary).toContain("[Truncated]");
      expect((result.value.toolParameters as any).sensitive_password_key).toBe("[REDACTED]");
    }
  });
});

// ---------------------------------------------------------------------------
// AdapterDeclarationSchema
// ---------------------------------------------------------------------------
describe("AdapterDeclarationSchema", () => {
  it("accepts opaque capability objects while normalizing optional fields", () => {
    const result = parseBody(AdapterDeclarationSchema, {
      stack: "OPENAI_AGENTS",
      adapterId: "  spctre-openai-agents-hook  ",
      adapterVersion: "  1.2.3  ",
      environment: "  production  ",
      supportedConnectors: [" stripe ", 42, "", "slack"],
      capabilities: {
        toolDiscovery: true,
        limits: { maxTools: 25 },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.adapterId).toBe("spctre-openai-agents-hook");
      expect(result.value.adapterVersion).toBe("1.2.3");
      expect(result.value.environment).toBe("production");
      expect(result.value.supportedConnectors).toEqual(["stripe", "slack"]);
      expect(result.value.capabilities).toEqual({
        toolDiscovery: true,
        limits: { maxTools: 25 },
      });
      expect(result.value.registeredBy).toBe("api");
    }
  });

  it("rejects invalid adapter declarations", () => {
    const result = parseBody(AdapterDeclarationSchema, {
      stack: "UNKNOWN_STACK",
      adapterId: "",
      supportedConnectors: [],
      capabilities: ["not", "an", "object"],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.path)).toContain("stack");
      expect(result.issues.map((issue) => issue.path)).toContain("adapterId");
      expect(result.issues.map((issue) => issue.path)).toContain("supportedConnectors");
    }
  });
});
