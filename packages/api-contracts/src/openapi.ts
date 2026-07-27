/**
 * Spctre OpenAPI 3.1 spec — the canonical source of truth for the public /api/v1/ surface.
 *
 * Consumed by:
 *   - GET /api/v1/openapi.json  (served by the web app)
 *   - SDK generators (DEFERRED — see §36-A)
 *   - schema.spctre.dev publication (DEFERRED — see §36-A)
 *
 * Extension conventions:
 *   x-spctre-plan: "oss"   — available in OSS and all paid tiers
 *   x-spctre-plan: "cloud" — Cloud-only; returns 402 with structured error for OSS tenants
 */

export const SPCTRE_OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "Spctre API",
    version: "2026-01",
    description:
      "The Spctre public REST API. All endpoints are versioned under `/api/v1/` and follow the same envelope convention: every response carries a `meta` object with a `traceId`, `version`, and `ts` timestamp. Authenticate with a service account API key issued from the Spctre web UI (`spctre init` or Settings → API Keys).",
    license: {
      name: "Apache 2.0",
      url: "https://www.apache.org/licenses/LICENSE-2.0.html",
    },
    contact: {
      name: "Spctre",
      url: "https://spctre.dev",
    },
  },
  servers: [
    {
      url: "/api/v1",
      description: "Spctre Public API v1",
    },
  ],
  security: [{ bearerAuth: [] }],

  // ──────────────────────────────────────────────────────────
  // Reusable components
  // ──────────────────────────────────────────────────────────
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "Service account API key. Generate one from the Spctre web UI under Settings → API Keys, then pass it as `Authorization: Bearer <key>`. Keys carry declared permission scopes such as `decision:evaluate`, `evidence:write`, `bundle:read`, `compliance:read`, `approvals:read`, `operations:read`, `workflow:read`, `members:read`, and `workspaces:read` that are enforced at the API layer.",
      },
    },

    schemas: {
      // ── Meta / envelope ─────────────────────────────────
      ApiMeta: {
        type: "object",
        required: ["traceId", "version", "ts"],
        properties: {
          traceId: {
            type: "string",
            description: "Correlation ID echoed from X-Request-ID or generated server-side.",
            examples: ["req_01j1x2y3z4"],
          },
          version: {
            type: "string",
            description: "API version string.",
            examples: ["2026-01"],
          },
          ts: {
            type: "string",
            format: "date-time",
            description: "ISO timestamp of the response.",
          },
        },
      },

      ApiError: {
        type: "object",
        required: ["error", "meta"],
        properties: {
          error: { type: "string", description: "Human-readable error message." },
          issues: {
            type: "array",
            description: "Field-level validation issues (present on 400 responses).",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                message: { type: "string" },
              },
            },
          },
          meta: { $ref: "#/components/schemas/ApiMeta" },
        },
      },

      Pagination: {
        type: "object",
        required: ["total", "limit", "offset"],
        properties: {
          total: { type: "integer" },
          limit: { type: "integer" },
          offset: { type: "integer" },
        },
      },

      // ── Shared sub-schemas ───────────────────────────────
      RuntimeStack: {
        type: "string",
        enum: [
          "AWS_BEDROCK",
          "GOOGLE_ADK",
          "AZURE_AI",
          "LANGCHAIN",
          "LANGGRAPH",
          "CREWAI",
          "AUTOGEN",
          "OPENAI_AGENTS",
          "OMNIGENT",
          "OPENCODE",
          "CLAUDE_CODE",
          "HERMES",
          "OPENCLAW",
          "NEMOCLAW",
          "CLAUDE_COWORK",
          "ODYSSEUS",
          "PAPERCLIP",
          "LOCAL",
          "CUSTOM",
        ],
      },

      TriggerKind: {
        type: "string",
        enum: [
          "interactive",
          "scheduled",
          "mobile_dispatch",
          "inbound_webhook",
          "routine",
          "gateway_message",
        ],
        description: "The invocation origin of the agent tool call.",
      },

      EvidenceLayer: {
        type: "string",
        enum: ["agent", "sandbox"],
        description: "Whether the evidence record originates from the agent layer (L7 tool calls) or sandbox layer (L3/L4 network policy).",
      },

      RuntimeDecisionStatus: {
        type: "string",
        enum: ["ALLOW", "DENY", "WARN", "ESCALATE"],
      },

      RuntimeTarget: {
        type: "object",
        required: ["stack"],
        properties: {
          stack: { $ref: "#/components/schemas/RuntimeStack" },
          adapter: { type: "string", description: "Specific adapter within the stack." },
          environment: { type: "string" },
          sandboxName: { type: "string", description: "Runtime sandbox/deployment name for sandbox-layer policy and evidence queries." },
          inferenceProvider: { type: "string", description: "Inference router/provider identifier for model-routing policy and evidence queries." },
        },
      },

      RuntimePolicyContext: {
        type: "object",
        required: ["scope", "branchId", "revisionId", "artifactHash"],
        properties: {
          scope: {
            type: "string",
            enum: ["ORGANIZATION", "WORKSPACE", "ENVIRONMENT", "CONNECTOR", "COMPANY"],
          },
          branchId: { type: "string", minLength: 1 },
          revisionId: { type: "string", minLength: 1 },
          artifactHash: { type: "string", minLength: 1 },
          packId: { type: "string" },
          packVersion: { type: "string" },
          packOwner: { type: "string" },
        },
      },

      // ── Evidence ─────────────────────────────────────────
      EvidenceIngestRequest: {
        type: "object",
        required: [
          "decisionId",
          "environment",
          "runtimeTarget",
          "agentId",
          "connector",
          "action",
          "status",
          "reason",
        ],
        properties: {
          decisionId: {
            type: "string",
            minLength: 1,
            description: "Unique ID for this governance decision (idempotency key).",
          },
          tenantId: {
            type: "string",
            description: "Optional tenant boundary hint. Empty string is treated as omitted. The x-spctre-tenant-id header takes precedence when both are present; otherwise inferred from the bearer token when omitted.",
          },
          workspaceId: {
            type: "string",
            description: "Optional workspace boundary hint. Empty string is treated as omitted. The x-spctre-workspace-id header takes precedence when both are present; otherwise inferred from the bearer token when omitted.",
          },
          environment: { type: "string", minLength: 1 },
          runtimeTarget: { $ref: "#/components/schemas/RuntimeTarget" },
          agentId: { type: "string", minLength: 1 },
          connector: { type: "string", minLength: 1 },
          action: { type: "string", minLength: 1 },
          status: { $ref: "#/components/schemas/RuntimeDecisionStatus" },
          reason: { type: "string", minLength: 1 },
          policyRefs: {
            type: "array",
            items: { type: "string" },
            description:
              "Required when ingestMode is omitted or 'standard'. Omit only when ingestMode is 'gateway'.",
          },
          artifactHash: {
            type: "string",
            description: "SHA-256 hash of the policy bundle artifact. Required in standard mode.",
          },
          policyContext: {
            type: "array",
            items: { $ref: "#/components/schemas/RuntimePolicyContext" },
            description: "Required in standard mode; server resolves it in gateway mode.",
          },
          latencyMs: { type: "integer", minimum: 0 },
          createdAt: {
            type: "string",
            format: "date-time",
            description: "Decision timestamp. Defaults to server time when omitted.",
          },
          rawEvidence: {
            type: "object",
            description: "Arbitrary key-value metadata attached to the evidence record.",
          },
          consequence: { type: "string" },
          customerTier: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          amountUsd: { type: "number", minimum: 0 },
          dataSensitivity: { type: "string" },
          trustScore: { type: "number" },
          contextBudget: { type: "integer" },
          sourceType: { type: "string" },
          executionTrace: { description: "Execution trace for forensic replay." },
          engineVersion: { type: "string" },
          ingestMode: {
            type: "string",
            enum: ["standard", "gateway"],
            description:
              "Use 'gateway' when posting from a gateway adapter; the server resolves policyRefs, artifactHash, and policyContext automatically.",
          },
          toolIntent: { type: "string", maxLength: 2000, description: "The explicitly declared intent or purpose of the tool call." },
          planSummary: { type: "string", maxLength: 4000, description: "A high-level plan summary explicitly provided by the runtime." },
          toolParameters: { type: "object", additionalProperties: true, description: "The structured arguments passed to the tool." },
          triggerKind: { $ref: "#/components/schemas/TriggerKind" },
          layer: { $ref: "#/components/schemas/EvidenceLayer" },
          executionContext: {
            type: "object",
            additionalProperties: true,
            description: "Execution surface identity plus sandbox/inference-router evidence references.",
            properties: {
              backend: { type: "string" },
              sessionId: { type: "string" },
              sandboxName: { type: "string" },
              inferenceProvider: { type: "string" },
              sandboxPolicyRef: { type: "string" },
              inferenceRouterRef: { type: "string" },
            },
          },
          parentAgentId: { type: "string", description: "Agent ID of the parent when this evidence originates from a subagent." },
          traceId: { type: "string", description: "Distributed trace identifier linking related agent decisions across subagents." },
          orchestratorRef: {
            type: "object",
            additionalProperties: true,
            required: ["platform"],
            description: "Orchestrator-platform reference (e.g. Paperclip companyId, issueId, goalId).",
            properties: {
              platform: { type: "string" },
              companyId: { type: "string" },
              issueId: { type: "string" },
              goalId: { type: "string" },
            },
          },
          pluginSource: {
            type: "string",
            enum: ["public_marketplace", "corporate_marketplace", "corporate_private", "user_built"],
            description: "Plugin provenance dimension.",
          },
          skillContext: {
            type: "object",
            additionalProperties: true,
            description: "Prompt-level governance surface: active skills, instruction files, and prompt policy refs present when the decision was made.",
            properties: {
              activeSkills: { type: "array", items: { type: "string" } },
              instructionFiles: { type: "array", items: { type: "string" } },
              promptPolicyRefs: { type: "array", items: { type: "string" } },
              promptSurface: { type: "string" },
            },
          },
          webhookSource: { type: "string", description: "Source identifier for inbound webhook triggers (present when triggerKind is inbound_webhook)." },
          trustLevel: { type: "string", description: "Trust level assigned by the orchestration platform (e.g. Paperclip trust preset)." },
          catalogProvider: { type: "string", description: "Catalog or skill provenance provider (e.g. Paperclip catalog-provenance identifier)." },
        },
      },

      EvidenceIngestResponse: {
        type: "object",
        required: ["evidence", "meta"],
        properties: {
          evidence: {
            type: "object",
            description: "The persisted evidence record (canonical shape).",
          },
          gateway: {
            type: "object",
            description: "Gateway evaluation result, if the gateway is enabled.",
            properties: {
              outcome: { type: "string", enum: ["PROCEED", "ESCALATE", "ABORT"] },
              reason: { type: "string" },
              riskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
              shouldQueue: { type: "boolean" },
            },
          },
          deduplicated: {
            type: "boolean",
            description: "True when a record with the same decisionId already exists (200 response).",
          },
          meta: { $ref: "#/components/schemas/ApiMeta" },
        },
      },

      GitCheckpointIngestRequest: {
        type: "object",
        required: ["idempotencyKey", "environment", "status", "reason", "checkpoint"],
        description: "Framework-agnostic Git checkpoint and diff evidence. Clients submit normalized Git facts; the server does not execute Git or access a caller repository.",
        properties: {
          idempotencyKey: { type: "string", minLength: 1, description: "Stable checkpoint submission key. Reuse it to safely retry." },
          environment: { type: "string", minLength: 1 },
          status: { $ref: "#/components/schemas/RuntimeDecisionStatus" },
          reason: { type: "string", minLength: 1 },
          checkpoint: {
            type: "object",
            required: ["id", "createdAt", "repository", "headCommit", "diff"],
            properties: {
              id: { type: "string", minLength: 1 },
              createdAt: { type: "string", format: "date-time" },
              repository: {
                type: "object",
                required: ["id"],
                properties: { id: { type: "string", minLength: 1 }, remoteUrl: { type: "string" } },
              },
              ref: { type: "string" },
              baseCommit: { type: "string" },
              headCommit: { type: "string", minLength: 1 },
              diff: {
                type: "object",
                required: ["format"],
                properties: {
                  format: { type: "string", enum: ["unified", "name-status", "none"] },
                  content: { type: "string", maxLength: 1000000 },
                  sha256: { type: "string" },
                  files: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["path"],
                      properties: {
                        path: { type: "string" },
                        status: { type: "string", enum: ["added", "modified", "deleted", "renamed", "copied", "unmerged"] },
                        previousPath: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          agent: { type: "object", properties: { id: { type: "string" }, adapter: { type: "string" } } },
          connector: { type: "string", description: "Optional client connector label; defaults to git." },
          action: { type: "string", description: "Optional action label; defaults to checkpoint.ingest." },
          policyRefs: { type: "array", items: { type: "string" }, description: "Caller-supplied references retained as metadata. Policy context is resolved server-side." },
          metadata: { type: "object", additionalProperties: true },
        },
      },

      // ── Gateway ───────────────────────────────────────────
      GatewayDecisionRequest: {
        type: "object",
        required: ["decisionId", "artifactHash", "policyContext"],
        properties: {
          decisionId: { type: "string", minLength: 1 },
          tenantId: {
            type: "string",
            description: "Optional tenant boundary hint. Empty string is treated as omitted. The x-spctre-tenant-id header takes precedence when both are present; otherwise inferred from the bearer token when omitted.",
          },
          workspaceId: {
            type: "string",
            description: "Optional workspace boundary hint. Empty string is treated as omitted. The x-spctre-workspace-id header takes precedence when both are present; otherwise inferred from the bearer token when omitted.",
          },
          artifactHash: { type: "string", minLength: 1 },
          policyContext: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/RuntimePolicyContext" },
          },
          reason: { type: "string" },
          consequence: { type: "string" },
          customerTier: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          amountUsd: { type: "number", minimum: 0 },
          dataSensitivity: { type: "string" },
          trustScore: { type: "number" },
          contextBudget: { type: "integer" },
          riskLevel: {
            type: "string",
            enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
          },
          toolIntent: { type: "string", maxLength: 2000, description: "The explicitly declared intent or purpose of the tool call." },
          planSummary: { type: "string", maxLength: 4000, description: "A high-level plan summary explicitly provided by the runtime." },
          toolParameters: { type: "object", additionalProperties: true, description: "The structured arguments passed to the tool." },
          connector: { type: "string" },
          action: { type: "string" },
          agentId: { type: "string", description: "Runtime agent identity used to link this decision to cross-surface evidence and governance history." },
          sessionId: { type: "string", minLength: 1, maxLength: 256, description: "Stable runtime session identifier used for Blueprint loop safeguards." },
        },
      },

      CredentialGrant: {
        type: "object",
        required: ["credentialType", "injectedParameter", "credentialValue", "expiresAt"],
        properties: {
          credentialType: { type: "string" },
          injectedParameter: { type: "string" },
          credentialValue: { type: "string" },
          expiresAt: { type: "string", format: "date-time" },
        },
      },

      GatewayDecision: {
        type: "object",
        required: ["outcome", "reason", "riskLevel", "shouldQueue"],
        properties: {
          outcome: { type: "string", enum: ["PROCEED", "ESCALATE", "ABORT"] },
          reason: { type: "string" },
          riskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
          shouldQueue: { type: "boolean" },
          slaHours: { type: "integer", minimum: 0 },
          credentialGrant: { $ref: "#/components/schemas/CredentialGrant" },
        },
      },

      GatewayDecisionResponse: {
        type: "object",
        required: ["gatewayEnabled", "mode", "persisted", "queued", "decision", "meta"],
        properties: {
          gatewayEnabled: { type: "boolean" },
          mode: { type: "string" },
          persisted: { type: "boolean" },
          queued: { type: "boolean" },
          decision: { $ref: "#/components/schemas/GatewayDecision" },
          meta: { $ref: "#/components/schemas/ApiMeta" },
        },
      },

      GatewayResolveRequest: {
        type: "object",
        required: ["queueId", "resolutionOutcome"],
        properties: {
          queueId: { type: "string", minLength: 1 },
          resolutionOutcome: {
            type: "string",
            enum: ["PROCEED", "ESCALATE", "ABORT"],
          },
          resolutionNote: { type: "string" },
          agentGuidance: { type: "string" },
        },
      },

      GatewayWebhookRequest: {
        type: "object",
        description:
          "Raw provider webhook payload from Portkey, Helicone, or LiteLLM. Spctre normalizes provider-specific fields into runtime evidence.",
        additionalProperties: true,
      },

      GatewayIngestResponse: {
        type: "object",
        required: ["decisionId", "provenanceGap", "deduplicated", "meta"],
        properties: {
          decisionId: { type: "string" },
          provenanceGap: {
            type: "boolean",
            description:
              "True when Spctre could not fully link the gateway event to a published policy revision or connector mapping.",
          },
          deduplicated: {
            type: "boolean",
            description: "True when the provider event was already ingested.",
          },
          meta: { $ref: "#/components/schemas/ApiMeta" },
        },
      },

      TokenRefreshRequest: {
        type: "object",
        required: ["refreshToken"],
        properties: {
          refreshToken: { type: "string", minLength: 1 },
        },
      },

      TokenRefreshResponse: {
        type: "object",
        required: ["accessToken", "accessTokenExpiresAt", "refreshToken", "refreshTokenExpiresAt", "meta"],
        properties: {
          accessToken: { type: "string" },
          accessTokenExpiresAt: { type: "string", format: "date-time" },
          refreshToken: { type: "string" },
          refreshTokenExpiresAt: { type: "string", format: "date-time" },
          meta: { $ref: "#/components/schemas/ApiMeta" },
        },
      },

      TrustScoreIngestRequest: {
        type: "object",
        required: ["agentId", "environment", "runtimeStack", "trustScore", "source"],
        properties: {
          agentId: { type: "string", minLength: 1 },
          environment: { type: "string", minLength: 1 },
          runtimeStack: { $ref: "#/components/schemas/RuntimeStack" },
          trustScore: { type: "number", minimum: 0, maximum: 1 },
          source: { type: "string", enum: ["EVIDENCE_INGEST", "POLICY_EVALUATION", "MANUAL", "IDENTITY_EVENT", "SYSTEM"] },
          sourceRef: { type: "string" },
          reason: { type: "string" },
        },
      },

      TrustEvaluateRequest: {
        type: "object",
        properties: {
          trustScore: { type: "number", minimum: 0, maximum: 1 },
          contextTokens: { type: "integer", minimum: 0 },
          budgetLimit: { type: "integer", minimum: 1 },
          agentClass: { type: "string" },
          environment: { type: "string" },
          connector: { type: "string" },
          consequenceTier: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
          sessionId: { type: "string" },
          agentId: { type: "string" },
          runtimeStack: { $ref: "#/components/schemas/RuntimeStack" },
        },
      },

      ContextBudgetIngestRequest: {
        type: "object",
        required: ["sessionId", "agentId", "environment", "runtimeStack", "eventType", "tokenCount"],
        properties: {
          sessionId: { type: "string", minLength: 1 },
          agentId: { type: "string", minLength: 1 },
          environment: { type: "string", minLength: 1 },
          runtimeStack: { $ref: "#/components/schemas/RuntimeStack" },
          eventType: { type: "string", enum: ["TOKEN_GROWTH", "SUMMARIZATION_EVENT", "CONTEXT_SOURCE_MIX", "BUDGET_BREACH"] },
          tokenCount: { type: "integer", minimum: 0 },
          tokenDelta: { type: "integer" },
          contextSourceMix: { type: "object" },
          budgetLimit: { type: "integer", minimum: 1 },
          budgetUtilization: { type: "number" },
          governanceAction: { type: "string", enum: ["ALLOW", "WARN", "ESCALATE", "REVIEW"] },
          policyRef: { type: "string" },
        },
      },

      EscalationQueueItem: {
        type: "object",
        description: "An open escalation queue item awaiting human review.",
        properties: {
          id: { type: "string" },
          decisionId: { type: "string" },
          outcome: { type: "string" },
          riskLevel: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          slaDeadlineAt: { type: "string", format: "date-time" },
          resolutionOutcome: { type: "string", nullable: true },
          resolvedAt: { type: "string", format: "date-time", nullable: true },
          agentGuidance: { type: "string", nullable: true },
        },
      },

      EscalationStatusResponse: {
        type: "object",
        required: ["decisionId", "status", "meta"],
        properties: {
          decisionId: { type: "string" },
          status: { type: "string", enum: ["PENDING", "IN_REVIEW", "RESOLVED", "EXPIRED"] },
          resolutionOutcome: { type: "string", enum: ["PROCEED", "ESCALATE", "ABORT"], nullable: true },
          resolutionNote: { type: "string", nullable: true },
          agentGuidance: { type: "string", nullable: true },
          slaDueAt: { type: "string", format: "date-time", nullable: true },
          resolvedAt: { type: "string", format: "date-time", nullable: true },
          approvedToolParameters: {
            type: "object",
            additionalProperties: true,
            description: "Immutable, redacted decision arguments. Present only when the escalation is RESOLVED with a PROCEED outcome.",
          },
          credentialGrant: { $ref: "#/components/schemas/CredentialGrant" },
          meta: { $ref: "#/components/schemas/ApiMeta" },
        },
      },

      // ── Bundle ────────────────────────────────────────────
      BundleResponse: {
        type: "object",
        description:
          "The latest published policy bundle for the workspace. Response headers carry `x-spctre-branch-id`, `x-spctre-revision-id`, `x-spctre-artifact-hash`, and `x-spctre-published-at`.",
      },

      BundleExportFormat: {
        type: "string",
        enum: ["spctre-json", "opa-rego", "opa-bundle", "cedar", "mcp-proxy-config"],
      },

      BundleExportManifest: {
        type: "object",
        required: [
          "format",
          "target",
          "compatibilityLevel",
          "semanticWarnings",
          "blockingWarnings",
          "verificationTargets",
          "artifactHash",
          "compiledArtifactHash",
          "generatedAt",
          "provenance",
          "ruleCount",
        ],
        properties: {
          format: { $ref: "#/components/schemas/BundleExportFormat" },
          target: { type: "string" },
          compatibilityLevel: {
            type: "string",
            enum: ["NATIVE", "LOSSLESS_PRESERVED", "PARTIAL_SEMANTIC_MAP"],
          },
          semanticWarnings: { type: "array", items: { type: "string" } },
          blockingWarnings: { type: "array", items: { type: "string" } },
          verificationTargets: { type: "array", items: { type: "string" } },
          artifactHash: { type: "string" },
          compiledArtifactHash: { type: "string" },
          generatedAt: { type: "string", format: "date-time" },
          provenance: {
            type: "object",
            required: ["tenantId", "workspaceId", "branchId", "revisionId", "sourceHash", "sourceFormat", "targetStacks"],
            properties: {
              tenantId: { type: "string" },
              workspaceId: { type: "string", nullable: true },
              branchId: { type: "string" },
              revisionId: { type: "string" },
              sourceHash: { type: "string" },
              sourceFormat: { type: "string" },
              sourcePath: { type: "string" },
              targetStacks: { type: "array", items: { type: "object" } },
            },
          },
          ruleCount: { type: "integer" },
        },
      },

      BundleExportEnvelope: {
        type: "object",
        required: ["artifact", "manifest", "meta"],
        properties: {
          artifact: {
            description: "Target artifact. String for text formats, object for JSON/bundle formats.",
            oneOf: [{ type: "string" }, { type: "object" }],
          },
          manifest: { $ref: "#/components/schemas/BundleExportManifest" },
          meta: { $ref: "#/components/schemas/ApiMeta" },
        },
      },

      BundleExportPreviewResponse: {
        type: "object",
        required: ["formats", "meta"],
        properties: {
          formats: {
            type: "array",
            items: { $ref: "#/components/schemas/BundleExportManifest" },
          },
          meta: { $ref: "#/components/schemas/ApiMeta" },
        },
      },

      BundleExportBlockedResponse: {
        type: "object",
        required: ["error", "manifest", "meta"],
        properties: {
          error: { type: "string" },
          manifest: { $ref: "#/components/schemas/BundleExportManifest" },
          meta: { $ref: "#/components/schemas/ApiMeta" },
        },
      },

      BundleExportVerification: {
        type: "object",
        required: ["ok", "expectedHash", "actualHash", "issues"],
        properties: {
          ok: { type: "boolean" },
          expectedHash: { type: "string" },
          actualHash: { type: "string", nullable: true },
          issues: { type: "array", items: { type: "string" } },
        },
      },

      BundleExportVerificationFailedResponse: {
        type: "object",
        required: ["error", "verification", "manifest", "meta"],
        properties: {
          error: { type: "string" },
          verification: { $ref: "#/components/schemas/BundleExportVerification" },
          manifest: { $ref: "#/components/schemas/BundleExportManifest" },
          meta: { $ref: "#/components/schemas/ApiMeta" },
        },
      },

      // ── Compliance ────────────────────────────────────────
      ComplianceExportResponse: {
        type: "object",
        required: ["schemaVersion", "exportedAt", "artifact", "summary", "escalations", "verificationResults", "frameworkAnnotation", "retentionPlan"],
        properties: {
          schemaVersion: { type: "string", examples: ["spctre/v1"] },
          exportedAt: { type: "string", format: "date-time" },
          artifact: { type: "object" },
          approvals: { type: "array", items: { type: "object" } },
          timeline: { type: "array", items: { type: "object" } },
          summary: {
            type: "object",
            properties: {
              evidenceCount: { type: "integer" },
              approvalCount: { type: "integer" },
              policyRefCount: { type: "integer" },
              deniedDecisionCount: { type: "integer" },
              warnedDecisionCount: { type: "integer" },
              simulationEventCount: { type: "integer" },
              packageSections: { type: "array", items: { type: "string" } },
              resolvedEscalationCount: { type: "integer" },
            },
          },
          escalations: { type: "array", items: { type: "object" } },
          verificationResults: { type: "object", nullable: true },
          frameworkAnnotation: { type: "object", nullable: true },
          retentionPlan: { type: "object", nullable: true },
        },
      },

      // ── Evaluate (simulation) ─────────────────────────────
      EvaluateRequest: {
        type: "object",
        required: ["connector", "action"],
        properties: {
          connector: { type: "string", minLength: 1 },
          action: { type: "string", minLength: 1 },
          domains: {
            type: "array",
            items: { type: "string" },
            description: "Optional domain tags used for additional policy matching.",
          },
          toolIntent: { type: "string", description: "The explicitly declared intent or purpose of the tool call." },
          planSummary: { type: "string", description: "A high-level plan summary explicitly provided by the runtime." },
          toolParameters: { type: "object", additionalProperties: true, description: "The structured arguments passed to the tool." },
        },
      },

      EvaluateResponse: {
        type: "object",
        required: ["connector", "action", "result", "meta"],
        properties: {
          connector: { type: "string" },
          action: { type: "string" },
          domains: { type: "array", items: { type: "string" } },
          branchId: { type: "string" },
          revisionId: { type: "string" },
          artifactHash: { type: "string" },
          publishedAt: { type: "string", format: "date-time" },
          result: {
            type: "object",
            description: "Policy evaluation result from the published bundle.",
          },
          meta: { $ref: "#/components/schemas/ApiMeta" },
        },
      },

      // ── Verification ──────────────────────────────────────
      VerificationIngestRequest: {
        type: "object",
        required: ["artifactHash", "verificationType", "outcome"],
        properties: {
          artifactHash: { type: "string", minLength: 1 },
          verificationType: {
            type: "string",
            enum: ["AGT_VERIFY", "AGT_VERIFY_EVIDENCE", "AGT_LINT_POLICY", "AGT_REDTEAM", "AGT_REPLAY", "CUSTOM"],
          },
          outcome: { type: "string", enum: ["PASS", "FAIL", "WARN"] },
          revisionId: { type: "string" },
          runtimeVersion: { type: "string" },
          argumentsHash: { type: "string" },
          approverDid: { type: "string" },
          policyVersion: { type: "string" },
          issuedAt: { type: "string", format: "date-time" },
          completedAt: { type: "string", format: "date-time" },
          agtVersion: { type: "string" },
          agtPoliciesVersion: { type: "string" },
          cedarPolicyVersion: { type: "string" },
          policyEngineVersion: { type: "string" },
          compatibilityCheckedAt: { type: "string", format: "date-time" },
          compatibilityCheckOutcome: { type: "string", enum: ["PASS", "FAIL", "WARN"] },
          escrowSignerId: { type: "string" },
          escrowKeyId: { type: "string" },
          outcomeHash: { type: "string" },
          escrowSignature: { type: "string" },
          escrowVerificationOutcome: { type: "string", enum: ["PASS", "FAIL", "WARN"] },
          escrowVerifiedAt: { type: "string", format: "date-time" },
          summary: { type: "object", description: "Arbitrary verification summary payload." },
        },
      },

      VerificationIngestResponse: {
        type: "object",
        required: ["ok", "outcome", "meta"],
        properties: {
          ok: { type: "boolean" },
          id: { type: "string" },
          outcome: { type: "string", enum: ["PASS", "FAIL", "WARN"] },
          meta: { $ref: "#/components/schemas/ApiMeta" },
        },
      },

      // ── Approvals ─────────────────────────────────────────
      ApprovalResponse: {
        type: "object",
        required: ["approval", "meta"],
        properties: {
          approval: {
            type: "object",
            description: "The approval record for the requested revision.",
          },
          meta: { $ref: "#/components/schemas/ApiMeta" },
        },
      },

    },

    responses: {
      Unauthorized: {
        description: "Authentication required or token invalid.",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
        },
      },
      Forbidden: {
        description: "Token lacks the required scope for this operation.",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
        },
      },
      NotFound: {
        description: "The requested resource does not exist.",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
        },
      },
      BadRequest: {
        description: "Request body failed schema validation.",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
        },
      },
      ServiceUnavailable: {
        description: "Database or upstream dependency unavailable.",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
        },
      },
      CloudOnly: {
        description:
          "This endpoint requires the Spctre Cloud plan. OSS tenants receive this structured error rather than a 404.",
        content: {
          "application/json": {
            schema: {
              allOf: [
                { $ref: "#/components/schemas/ApiError" },
                {
                  properties: {
                    plan: { type: "string", enum: ["cloud"], description: "Required plan tier." },
                  },
                },
              ],
            },
          },
        },
      },
    },
  },

  // ──────────────────────────────────────────────────────────
  // Paths
  // ──────────────────────────────────────────────────────────
  paths: {
    // ── Evidence ─────────────────────────────────────────────
    "/evidence": {
      post: {
        operationId: "ingestEvidence",
        summary: "Ingest a governance decision as evidence",
        description:
          "Records an agent runtime governance decision in the evidence store. Supports both standard mode (caller supplies policyRefs, artifactHash, policyContext) and gateway mode (server resolves policy context via revision-at-time lookup). Duplicate `decisionId` submissions return 200 with `deduplicated: true` and are suppressed.",
        "x-spctre-plan": "oss",
        tags: ["Evidence"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EvidenceIngestRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Evidence ingested successfully.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EvidenceIngestResponse" },
              },
            },
          },
          "200": {
            description: "Duplicate submission — evidence with this decisionId already exists.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EvidenceIngestResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },

    "/evidence/git-checkpoints": {
      post: {
        operationId: "ingestGitCheckpoint",
        summary: "Ingest a Git checkpoint and diff",
        description: "Accepts framework-agnostic, normalized Git checkpoint and diff metadata. The server resolves policy context at the checkpoint timestamp and persists the result as evidence. It never executes Git or reads a client repository.",
        "x-spctre-plan": "oss",
        tags: ["Evidence"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/GitCheckpointIngestRequest" } } },
        },
        responses: {
          "201": { description: "Checkpoint evidence ingested.", content: { "application/json": { schema: { $ref: "#/components/schemas/EvidenceIngestResponse" } } } },
          "200": { description: "Duplicate submission suppressed.", content: { "application/json": { schema: { $ref: "#/components/schemas/EvidenceIngestResponse" } } } },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "503": { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },

    // ── Gateway ───────────────────────────────────────────────
    "/gateway/decide": {
      post: {
        operationId: "gatewayDecide",
        summary: "Evaluate a gateway decision",
        description:
          "Evaluates a governance decision against the active policy bundle and returns an outcome (`PROCEED`, `ESCALATE`, or `ABORT`). When the gateway is disabled the response always returns `PROCEED`. Decisions that trigger `shouldQueue: true` are placed in the escalation queue.",
        "x-spctre-plan": "oss",
        tags: ["Gateway"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/GatewayDecisionRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Decision evaluated.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GatewayDecisionResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "503": { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },

    "/gateway/resolve": {
      post: {
        operationId: "gatewayResolve",
        summary: "Resolve an escalation queue item",
        description:
          "Closes an open escalation queue item with a resolution outcome (`PROCEED`, `ESCALATE`, or `ABORT`). Requires web session authentication — this operation represents a human-in-the-loop decision.",
        "x-spctre-plan": "oss",
        tags: ["Gateway"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/GatewayResolveRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Escalation resolved.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    meta: { $ref: "#/components/schemas/ApiMeta" },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    "/gateway/escalations": {
      get: {
        operationId: "listEscalations",
        summary: "List open escalation queue items",
        description:
          "Returns open escalation queue items for the authenticated workspace. Results are ordered by creation time descending.",
        "x-spctre-plan": "oss",
        tags: ["Gateway"],
        parameters: [
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            description: "Maximum number of items to return.",
          },
        ],
        responses: {
          "200": {
            description: "Escalation queue.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    queue: {
                      type: "array",
                      items: { $ref: "#/components/schemas/EscalationQueueItem" },
                    },
                    count: { type: "integer" },
                    generatedAt: { type: "string", format: "date-time" },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                    meta: { $ref: "#/components/schemas/ApiMeta" },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },

    "/gateway/escalations/status": {
      get: {
        operationId: "getEscalationStatus",
        summary: "Get gateway decision escalation status",
        description:
          "Checks the current status of an escalation queue item by its decision ID.",
        "x-spctre-plan": "oss",
        tags: ["Gateway"],
        parameters: [
          {
            name: "decisionId",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "The unique gateway decision ID.",
          },
        ],
        responses: {
          "200": {
            description: "Escalation status.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EscalationStatusResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "503": { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },

    "/gateway-ingest/portkey": {
      post: {
        operationId: "ingestPortkeyGatewayEvent",
        summary: "Ingest a Portkey gateway webhook",
        description:
          "Accepts a raw Portkey webhook payload, normalizes it into Spctre runtime evidence, resolves policy context at event time, and records provenance-gap metadata when context cannot be fully resolved.",
        "x-spctre-plan": "oss",
        tags: ["Gateway", "Evidence"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/GatewayWebhookRequest" },
            },
          },
        },
        responses: {
          "201": { description: "Gateway event ingested.", content: { "application/json": { schema: { $ref: "#/components/schemas/GatewayIngestResponse" } } } },
          "200": { description: "Duplicate gateway event.", content: { "application/json": { schema: { $ref: "#/components/schemas/GatewayIngestResponse" } } } },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "422": { $ref: "#/components/responses/BadRequest" },
          "503": { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },

    "/gateway-ingest/helicone": {
      post: {
        operationId: "ingestHeliconeGatewayEvent",
        summary: "Ingest a Helicone gateway webhook",
        description:
          "Accepts a raw Helicone webhook payload and stores it as Spctre runtime evidence with provider metadata and revision-at-time provenance.",
        "x-spctre-plan": "oss",
        tags: ["Gateway", "Evidence"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/GatewayWebhookRequest" },
            },
          },
        },
        responses: {
          "201": { description: "Gateway event ingested.", content: { "application/json": { schema: { $ref: "#/components/schemas/GatewayIngestResponse" } } } },
          "200": { description: "Duplicate gateway event.", content: { "application/json": { schema: { $ref: "#/components/schemas/GatewayIngestResponse" } } } },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "422": { $ref: "#/components/responses/BadRequest" },
          "503": { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },

    "/gateway-ingest/litellm": {
      post: {
        operationId: "ingestLiteLLMGatewayEvent",
        summary: "Ingest a LiteLLM gateway webhook",
        description:
          "Accepts a raw LiteLLM webhook payload and stores it as Spctre runtime evidence with provider metadata and revision-at-time provenance.",
        "x-spctre-plan": "oss",
        tags: ["Gateway", "Evidence"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/GatewayWebhookRequest" },
            },
          },
        },
        responses: {
          "201": { description: "Gateway event ingested.", content: { "application/json": { schema: { $ref: "#/components/schemas/GatewayIngestResponse" } } } },
          "200": { description: "Duplicate gateway event.", content: { "application/json": { schema: { $ref: "#/components/schemas/GatewayIngestResponse" } } } },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "422": { $ref: "#/components/responses/BadRequest" },
          "503": { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },

    "/token/refresh": {
      post: {
        operationId: "refreshToken",
        summary: "Rotate an access/refresh token pair",
        description:
          "Exchanges a valid refresh token for a fresh short-lived access token and rolling refresh token. The previous access token is revoked and the previous refresh token is marked rotated.",
        "x-spctre-plan": "oss",
        tags: ["Auth"],
        security: [],
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            schema: { type: "string" },
            description: "Optional client-generated key for retrying a refresh request.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TokenRefreshRequest" },
            },
          },
        },
        responses: {
          "200": { description: "Token pair rotated.", content: { "application/json": { schema: { $ref: "#/components/schemas/TokenRefreshResponse" } } } },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "503": { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },

    "/token/revoke": {
      post: {
        operationId: "revokeToken",
        summary: "Revoke the current service token",
        description:
          "Revokes the bearer access token used for the request and any active refresh token linked to it. Successful revocation returns 204 with no body.",
        "x-spctre-plan": "oss",
        tags: ["Auth"],
        security: [{ bearerAuth: [] }],
        responses: {
          "204": { description: "Token revoked." },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "503": { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },

    "/trust/ingest": {
      post: {
        operationId: "ingestTrustScore",
        summary: "Ingest a trust-score observation",
        description:
          "Records a trust-score observation for an agent, computes score delta against the prior observation, and appends a trust-score operations-log event.",
        "x-spctre-plan": "oss",
        tags: ["Trust"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/TrustScoreIngestRequest" } } },
        },
        responses: {
          "201": { description: "Trust score ingested.", content: { "application/json": { schema: { type: "object" } } } },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "503": { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },

    "/trust/evaluate": {
      post: {
        operationId: "evaluateTrustGovernance",
        summary: "Evaluate trust and context-budget governance",
        description:
          "Evaluates trust score and context-token state against enabled calibration policies, returning an ALLOW/WARN/REVIEW/ESCALATE action plus a gateway risk hint.",
        "x-spctre-plan": "oss",
        tags: ["Trust"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/TrustEvaluateRequest" } } },
        },
        responses: {
          "200": { description: "Trust governance evaluated.", content: { "application/json": { schema: { type: "object" } } } },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "503": { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },

    "/trust/context-budget": {
      post: {
        operationId: "ingestContextBudgetEvent",
        summary: "Ingest a context-budget telemetry event",
        description:
          "Records context token growth, summarization, source mix, or budget breach telemetry. Budget breaches are written to the operations log.",
        "x-spctre-plan": "oss",
        tags: ["Trust"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ContextBudgetIngestRequest" } } },
        },
        responses: {
          "201": { description: "Context-budget event ingested.", content: { "application/json": { schema: { type: "object" } } } },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "503": { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },

    // ── Bundle ────────────────────────────────────────────────
    "/bundle/latest": {
      get: {
        operationId: "getBundleLatest",
        summary: "Download the latest published policy bundle",
        description:
          "Returns the latest published policy bundle for the authenticated workspace. Without `format`, the response is the raw AGT-compatible JSON bundle. With `format`, the response is an export envelope containing a target artifact and manifest. Use `preview=true` with no format to inspect all target manifests without downloading artifacts.",
        "x-spctre-plan": "oss",
        tags: ["Bundle"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "format",
            in: "query",
            required: false,
            schema: { $ref: "#/components/schemas/BundleExportFormat" },
            description: "Optional target export format. Omit for the raw AGT-compatible bundle.",
          },
          {
            name: "preview",
            in: "query",
            required: false,
            schema: { type: "boolean" },
            description: "When true and format is omitted, returns manifests for all supported export targets without artifacts.",
          },
        ],
        responses: {
          "200": {
            description: "Latest published bundle, export envelope, or preview manifest list.",
            headers: {
              "x-spctre-branch-id": { schema: { type: "string" } },
              "x-spctre-revision-id": { schema: { type: "string" } },
              "x-spctre-artifact-hash": { schema: { type: "string" } },
              "x-spctre-published-at": { schema: { type: "string", format: "date-time" } },
              "x-spctre-export-format": { schema: { type: "string" } },
              "x-spctre-export-ok": { schema: { type: "string", enum: ["true", "false"] } },
              "x-spctre-export-verified": { schema: { type: "string", enum: ["true", "false"] } },
            },
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/BundleResponse" },
                    { $ref: "#/components/schemas/BundleExportEnvelope" },
                    { $ref: "#/components/schemas/BundleExportPreviewResponse" },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "409": {
            description: "Requested export target is blocked because semantics cannot be safely preserved.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BundleExportBlockedResponse" },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": {
            description: "Export artifact failed local manifest verification before handoff.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BundleExportVerificationFailedResponse" },
              },
            },
          },
          "503": { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },

    // ── Compliance ────────────────────────────────────────────
    "/compliance/export": {
      get: {
        operationId: "exportCompliance",
        summary: "Export the compliance packet",
        description:
          "Generates and returns the latest compliance packet for the workspace as a JSON attachment. Optionally annotated for a specific framework (`soc2`, `iso27001`, `hipaa`, `gdpr`, `pci-dss`, `nist-ai-rmf`, `public-sector`, `eu-ai-act`).",
        "x-spctre-plan": "oss",
        tags: ["Compliance"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "framework",
            in: "query",
            schema: {
              type: "string",
              enum: ["soc2", "iso27001", "hipaa", "gdpr", "pci-dss", "nist-ai-rmf", "public-sector", "eu-ai-act"],
            },
            description:
              "Framework to annotate the export for. When omitted the raw packet is returned without framework-specific annotations.",
          },
          {
            name: "format",
            in: "query",
            schema: {
              type: "string",
              enum: ["json", "pdf"],
              default: "json",
            },
            description: "Export format. PDF export is plan-gated.",
          },
        ],
        responses: {
          "200": {
            description: "Compliance packet.",
            headers: {
              "x-spctre-artifact-hash": { schema: { type: "string" } },
              "x-spctre-revision-id": { schema: { type: "string" } },
            },
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ComplianceExportResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "503": { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },

    // ── Evaluate (simulation) ─────────────────────────────────
    "/evaluate": {
      post: {
        operationId: "evaluatePolicy",
        summary: "Simulate a policy decision",
        description:
          "Evaluates a connector + action pair against the latest published policy bundle without persisting a record. Useful for CI/CD checks and policy simulation.",
        "x-spctre-plan": "oss",
        tags: ["Simulation"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EvaluateRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Evaluation result.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EvaluateResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "503": { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },

    // ── Verification ──────────────────────────────────────────
    "/verification": {
      post: {
        operationId: "ingestVerification",
        summary: "Ingest a verification result",
        description:
          "Records the outcome of a policy verification run (lint, evidence coverage check, red-team, or custom) against a specific policy artifact.",
        "x-spctre-plan": "oss",
        tags: ["Verification"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/VerificationIngestRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Verification result ingested.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/VerificationIngestResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      get: {
        operationId: "listVerifications",
        summary: "List verification results",
        description:
          "Returns verification results for the workspace, optionally filtered by revisionId or artifactHash.",
        "x-spctre-plan": "oss",
        tags: ["Verification"],
        parameters: [
          {
            name: "revisionId",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "artifactHash",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          },
        ],
        responses: {
          "200": {
            description: "Verification results.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    results: { type: "array", items: { type: "object" } },
                    count: { type: "integer" },
                    generatedAt: { type: "string", format: "date-time" },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                    meta: { $ref: "#/components/schemas/ApiMeta" },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },

    // ── Approvals ─────────────────────────────────────────────
    "/approvals/{id}": {
      get: {
        operationId: "getApproval",
        summary: "Get an approval by ID",
        description:
          "Returns the approval record for a specific revision approval ID.",
        "x-spctre-plan": "oss",
        tags: ["Approvals"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "The approval ID.",
          },
        ],
        responses: {
          "200": {
            description: "Approval record.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApprovalResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── Self ──────────────────────────────────────────────────
    "/openapi.json": {
      get: {
        operationId: "getOpenApiSpec",
        summary: "OpenAPI 3.1 specification",
        description: "Returns this OpenAPI specification document.",
        "x-spctre-plan": "oss",
        tags: ["Meta"],
        security: [],
        responses: {
          "200": {
            description: "OpenAPI 3.1 spec.",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },

    // ── Cloud-only (gated) ────────────────────────────────────
    "/evidence/forensic": {
      get: {
        operationId: "forensicEvidenceQuery",
        summary: "Forensic archival evidence query",
        description:
          "Query the full tenant event log for forensic replay and archival analysis. Returns up to 10,000 records per request with cursor-based pagination.",
        "x-spctre-plan": "cloud",
        tags: ["Evidence", "Cloud"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "from",
            in: "query",
            schema: { type: "string", format: "date-time" },
            description: "Start of the time window (inclusive).",
          },
          {
            name: "to",
            in: "query",
            schema: { type: "string", format: "date-time" },
            description: "End of the time window (exclusive).",
          },
          {
            name: "cursor",
            in: "query",
            schema: { type: "string" },
            description: "Pagination cursor from a previous response.",
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 10000, default: 1000 },
          },
        ],
        responses: {
          "200": {
            description: "Forensic evidence page.",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "402": { $ref: "#/components/responses/CloudOnly" },
        },
      },
    },

    "/evaluate/bulk": {
      post: {
        operationId: "bulkSimulate",
        summary: "Bulk simulation against the full tenant event log",
        description:
          "Runs a policy simulation against the tenant's complete historical evidence log. Useful for impact analysis before publishing a new policy revision.",
        "x-spctre-plan": "cloud",
        tags: ["Simulation", "Cloud"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["revisionId"],
                properties: {
                  revisionId: {
                    type: "string",
                    description: "The policy revision to simulate against the historical log.",
                  },
                  fromDate: { type: "string", format: "date-time" },
                  toDate: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Simulation job accepted. Poll the returned jobId for results.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { jobId: { type: "string" }, meta: { $ref: "#/components/schemas/ApiMeta" } },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "402": { $ref: "#/components/responses/CloudOnly" },
        },
      },
    },

    "/scim/v2/Users": {
      get: {
        operationId: "scimListUsers",
        summary: "SCIM 2.0 — list users",
        description: "SCIM 2.0 user provisioning endpoint for IdP integration.",
        "x-spctre-plan": "cloud",
        tags: ["SCIM", "Cloud"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "filter", in: "query", schema: { type: "string" } },
          { name: "startIndex", in: "query", schema: { type: "integer", default: 1 } },
          { name: "count", in: "query", schema: { type: "integer", default: 100 } },
        ],
        responses: {
          "200": { description: "SCIM ListResponse.", content: { "application/scim+json": { schema: { type: "object" } } } },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "402": { $ref: "#/components/responses/CloudOnly" },
        },
      },
      post: {
        operationId: "scimCreateUser",
        summary: "SCIM 2.0 — create user",
        description: "Provision a new user via SCIM 2.0.",
        "x-spctre-plan": "cloud",
        tags: ["SCIM", "Cloud"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/scim+json": { schema: { type: "object" } } },
        },
        responses: {
          "201": { description: "User created.", content: { "application/scim+json": { schema: { type: "object" } } } },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "402": { $ref: "#/components/responses/CloudOnly" },
        },
      },
    },
  },

  // ── Tags ─────────────────────────────────────────────────────
  tags: [
    { name: "Evidence", description: "Agent runtime governance decision ingestion." },
    { name: "Gateway", description: "Policy enforcement gateway — decide, escalate, and resolve." },
    { name: "Bundle", description: "Published policy bundle download." },
    { name: "Compliance", description: "Compliance packet export and framework annotation." },
    { name: "Simulation", description: "Policy simulation and evaluation." },
    { name: "Verification", description: "Policy verification result ingestion and query." },
    { name: "Approvals", description: "Revision approval status queries." },
    { name: "Auth", description: "Token lifecycle and service identity." },
    { name: "Trust", description: "Trust-score and context-budget runtime governance." },
    { name: "Meta", description: "API meta endpoints (spec, health)." },
    { name: "Cloud", description: "Cloud-only endpoints (x-spctre-plan: cloud). Returns 402 for OSS tenants." },
    { name: "SCIM", description: "SCIM 2.0 user provisioning (Cloud only)." },
  ],
} as const;
