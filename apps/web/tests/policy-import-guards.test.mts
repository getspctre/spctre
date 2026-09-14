import { beforeEach, describe, expect, it, vi } from "vitest";

// What the import path refuses, and why each refusal exists.
//
// Split from policy-domain-service.test.mts deliberately: that file covers the
// service's shape, this one covers the guards in front of drafting a policy.
// Every refusal below prevents a document that parses cleanly from becoming a
// policy that enforces the opposite of what its author meant — an empty policy,
// a rule that matches everything, or a rule the kernel will silently never
// match. A policy that reads as healthy and enforces nothing is the failure
// this surface exists to stop.
//
// The token path carries the strictest set, because it is the unattended one:
// the browser importer keeps a human in front of the result.

const importPolicyBranchIdempotentSpy = vi.fn();
const persistImportedBranchSpy = vi.fn();
const getWorkspaceContextSpy = vi.fn();
const resolveWorkspaceForActionSpy = vi.fn();
const getActiveActorSpy = vi.fn();
const requireActorAdminWorkspaceSpy = vi.fn();
const insertAuthorizationDenialEventSpy = vi.fn();
const isDatabaseConfiguredSpy = vi.fn();
const loggerErrorSpy = vi.fn();

vi.mock("@/lib/repositories/policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/policy")>();
  return {
    ...actual,
    importPolicyBranchIdempotent: importPolicyBranchIdempotentSpy,
    persistImportedBranch: persistImportedBranchSpy,
  };
});
vi.mock("@/lib/repositories/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/workspace")>();
  return {
    ...actual,
    resolveWorkspaceForAction: resolveWorkspaceForActionSpy,
    insertAuthorizationDenialEvent: insertAuthorizationDenialEventSpy,
  };
});
vi.mock("@/lib/repositories/shared/database", () => ({
  isDatabaseConfigured: isDatabaseConfiguredSpy,
}));
vi.mock("@/lib/workspace", () => ({ getWorkspaceContext: getWorkspaceContextSpy }));
vi.mock("@/lib/actors", () => ({
  getActiveActor: getActiveActorSpy,
  requireActorAdminWorkspace: requireActorAdminWorkspaceSpy,
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: (_tenantId: string, fn: () => unknown) => fn(),
}));
vi.mock("@spctre/platform/logging", () => ({ logger: { error: loggerErrorSpy, info: vi.fn() } }));

const { importPolicyForToken, importPolicyDecision, previewPolicyImport } =
  await import("../lib/domains/policy/service");

const TENANT = "tenant-1";
const WORKSPACE = "workspace-1";

/** A minimal AGT document with one properly targeted rule. */
function policyYaml(
  options: { ruleId?: string; connectors?: string; rules?: string } = {},
): string {
  const rules =
    options.rules ??
    `  - id: ${options.ruleId ?? "payments.refund.guard"}
    title: Guard refunds
    effect: DENY
    connectors: [${options.connectors ?? "stripe"}]
    actions: [refund.create]
`;
  return `apiVersion: agt/v4
kind: Policy
metadata:
  name: test-policy
rules:
${rules}`;
}

function tokenInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    principalId: "principal-1",
    source: policyYaml(),
    branchName: "ci/import",
    scope: "WORKSPACE",
    environment: "",
    connector: "",
    sourcePath: "policy.yaml",
    targetStacks: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isDatabaseConfiguredSpy.mockReturnValue(true);
  importPolicyBranchIdempotentSpy.mockResolvedValue({
    branchId: "branch-1",
    revisionId: "revision-1",
    sourceHash: "sha256:abcd",
    created: true,
    alreadyCurrent: false,
  });
  getWorkspaceContextSpy.mockResolvedValue({
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    workspaceSlug: "acme",
  });
  resolveWorkspaceForActionSpy.mockResolvedValue({ id: WORKSPACE, slug: "acme" });
  getActiveActorSpy.mockResolvedValue({ actor: { id: "actor-1", name: "Ada Admin" } });
  requireActorAdminWorkspaceSpy.mockReturnValue({ allowed: true });
  persistImportedBranchSpy.mockResolvedValue({
    branchId: "branch-1",
    revisionId: "revision-1",
    sourceHash: "sha256:abcd",
    importedAt: "2026-09-14T00:00:00.000Z",
  });
});

describe("a workspace-bound token cannot draft organization policy", () => {
  it("refuses ORGANIZATION scope before parsing anything", async () => {
    // service_token.workspace_id is NOT NULL, so an organization-scoped import
    // would produce a branch with workspace_id = NULL — a workspace-scoped
    // credential writing tenant-wide policy.
    const result = await importPolicyForToken(tokenInput({ scope: "ORGANIZATION" }));

    expect(result).toEqual({
      error: "Service tokens are workspace-bound; ORGANIZATION-scoped import is not supported.",
      status: 400,
    });
    expect(importPolicyBranchIdempotentSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["WORKSPACE", {}],
    ["CONNECTOR", { connector: "stripe" }],
    ["ENVIRONMENT", { environment: "production" }],
  ])("allows %s scope when its qualifier is present", async (scope, qualifier) => {
    const result = await importPolicyForToken(tokenInput({ scope, ...qualifier }));

    expect(result).not.toHaveProperty("error");
  });

  it.each([
    ["CONNECTOR", "Connector is required for CONNECTOR-scoped branches."],
    ["ENVIRONMENT", "Environment is required for ENVIRONMENT-scoped branches."],
  ])("refuses %s scope with no qualifier", async (scope, error) => {
    // A scoped branch with nothing to scope it to would resolve as though it
    // were workspace-wide.
    const result = await importPolicyForToken(tokenInput({ scope }));

    expect(result).toMatchObject({ error, status: 400 });
    expect(importPolicyBranchIdempotentSpy).not.toHaveBeenCalled();
  });
});

describe("a policy with nothing in it is refused", () => {
  it("refuses a document with no rules", async () => {
    // Parses with only a WARNING, and an empty revision that reaches
    // publication is a default-allow policy.
    const result = await importPolicyForToken(tokenInput({ source: policyYaml({ rules: "" }) }));

    expect(result).toMatchObject({
      error: "Policy document contains no rules; refusing to import an empty policy.",
      status: 400,
    });
    expect(importPolicyBranchIdempotentSpy).not.toHaveBeenCalled();
  });
});

describe("a rule that matches everything is refused", () => {
  it("refuses a rule with no connector, action or domain", async () => {
    const result = await importPolicyForToken(
      tokenInput({
        source: policyYaml({
          rules: `  - id: catch.all
    title: Catch everything
    effect: DENY
`,
        }),
      }),
    );

    expect(result).toMatchObject({ status: 400 });
    expect("error" in result && result.error).toMatch(
      /"catch\.all" has no connector, action, or domain target/,
    );
    expect(importPolicyBranchIdempotentSpy).not.toHaveBeenCalled();
  });

  it("names the offending rule so the author can find it", async () => {
    const result = await importPolicyForToken(
      tokenInput({
        source: policyYaml({
          rules: `  - id: payments.refund.guard
    title: Fine
    effect: DENY
    connectors: [stripe]
    actions: [refund.create]
  - id: the.bad.one
    title: Catch everything
    effect: WARN
`,
        }),
      }),
    );

    expect("error" in result && result.error).toContain("the.bad.one");
  });

  it("accepts a rule targeted by domain alone", async () => {
    const result = await importPolicyForToken(
      tokenInput({
        source: policyYaml({
          rules: `  - id: scoped.by.domain
    title: Domain scoped
    effect: DENY
    domains: [payments]
`,
        }),
      }),
    );

    expect(result).not.toHaveProperty("error");
  });
});

describe("failures from the repository are mapped, not leaked", () => {
  it("turns an unavailable workspace into a 404", async () => {
    importPolicyBranchIdempotentSpy.mockRejectedValue(
      new Error("Workspace is not available for this tenant"),
    );

    const result = await importPolicyForToken(tokenInput());

    expect(result).toEqual({ error: "Workspace not found.", status: 404 });
  });

  it("turns anything else into a 500 without echoing the database error", async () => {
    importPolicyBranchIdempotentSpy.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "policy_branch_name_key"'),
    );

    const result = await importPolicyForToken(tokenInput());

    expect(result).toEqual({
      error: "An unexpected error occurred. Please try again.",
      status: 500,
    });
    expect(loggerErrorSpy).toHaveBeenCalled();
  });
});

describe("what the token path passes through", () => {
  it("imports as the token's own principal, into the token's workspace", async () => {
    await importPolicyForToken(tokenInput());

    expect(importPolicyBranchIdempotentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        authorId: "principal-1",
        message: "Import via policy:import token",
      }),
    );
  });

  it("reports the rule count with the result", async () => {
    const result = await importPolicyForToken(tokenInput());

    expect(result).toMatchObject({ result: expect.objectContaining({ ruleCount: 1 }) });
  });

  it("passes an empty environment and connector as undefined, not empty strings", async () => {
    await importPolicyForToken(tokenInput({ environment: "", connector: "" }));

    const call = importPolicyBranchIdempotentSpy.mock.calls[0][0];
    expect(call.environment).toBeUndefined();
    expect(call.connector).toBeUndefined();
  });
});

describe("the browser import path", () => {
  it("records a denial and refuses when the actor is not an admin of the workspace", async () => {
    requireActorAdminWorkspaceSpy.mockReturnValue({
      allowed: false,
      reason: "Actor Ada Admin does not have admin permission for acme.",
    });

    const result = await importPolicyDecision({
      source: policyYaml(),
      branchName: "ui/import",
      scope: "WORKSPACE",
      environment: "",
      connector: "",
      requestedWorkspaceId: WORKSPACE,
      sourcePath: "policy.yaml",
      targetStacks: [],
    });

    expect(result).toEqual({ error: "Actor Ada Admin does not have admin permission for acme." });
    expect(persistImportedBranchSpy).not.toHaveBeenCalled();
    expect(insertAuthorizationDenialEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "policy.import", resourceType: "workspace" }),
    );
  });

  it("refuses when the requested workspace cannot be resolved", async () => {
    resolveWorkspaceForActionSpy.mockResolvedValue(null);

    const result = await importPolicyDecision({
      source: policyYaml(),
      branchName: "ui/import",
      scope: "WORKSPACE",
      environment: "",
      connector: "",
      requestedWorkspaceId: "workspace-elsewhere",
      sourcePath: "policy.yaml",
      targetStacks: [],
    });

    expect(result).toEqual({ error: "Workspace not found." });
    expect(getActiveActorSpy).not.toHaveBeenCalled();
  });

  it("does not apply the token path's empty-policy guard", async () => {
    // Deliberate asymmetry: the browser importer shows the result to a person
    // before anything is approved, so an empty draft is recoverable there.
    const result = await importPolicyDecision({
      source: policyYaml({ rules: "" }),
      branchName: "ui/import",
      scope: "WORKSPACE",
      environment: "",
      connector: "",
      requestedWorkspaceId: WORKSPACE,
      sourcePath: "policy.yaml",
      targetStacks: [],
    });

    expect(result).not.toHaveProperty("error");
    expect(persistImportedBranchSpy).toHaveBeenCalled();
  });
});

describe("preview writes nothing", () => {
  it("returns the parsed rules without touching the repository", () => {
    const preview = previewPolicyImport({
      source: policyYaml(),
      branchName: "ui/import",
      scope: "WORKSPACE",
      environment: "",
      connector: "",
      sourcePath: "policy.yaml",
    });

    expect(preview).toHaveProperty("result");
    expect(persistImportedBranchSpy).not.toHaveBeenCalled();
    expect(importPolicyBranchIdempotentSpy).not.toHaveBeenCalled();
  });

  it("surfaces a parse error rather than throwing", () => {
    const preview = previewPolicyImport({
      source: "this: is: not: a: policy",
      branchName: "ui/import",
      scope: "WORKSPACE",
      environment: "",
      connector: "",
      sourcePath: "policy.yaml",
    });

    expect(preview).toHaveProperty("error");
  });
});
