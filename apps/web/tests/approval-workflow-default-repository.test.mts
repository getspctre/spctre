import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  sql: sqlMock,
}));

const repository = await import("../lib/repositories/approval-workflow/config");

describe("default approval workflow repository", () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it("uses the sole workspace reviewer's eligible role when no workflow is configured", async () => {
    sqlMock.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = Array.from(strings).join(" ");
      if (query.includes("WITH candidate_workflows")) return [];
      if (query.includes("FROM principal_permission_grant")) {
        expect(query).toContain("g.workspace_id IS NULL OR g.workspace_id =");
        expect(query).toContain("p.invite_status = 'ACCEPTED'");
        expect(query).toContain("p.idp_deprovisioned_at IS NULL");
        expect(values).toEqual(["tenant-1", "workspace-1"]);
        return [{ principal_id: "reviewer-1", reviewer_roles: ["Security", "Platform"] }];
      }
      throw new Error(`unexpected query: ${query}`);
    });

    const workflow = await repository.getApprovalWorkflowForContext({
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
    });

    expect(repository.approvalRulesFromWorkflow(workflow)).toEqual([
      { role: "Security", requiredCount: 1 },
    ]);
  });

  it("keeps the Security and Platform default when multiple reviewers are eligible", async () => {
    sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
      const query = Array.from(strings).join(" ");
      if (query.includes("WITH candidate_workflows")) return [];
      if (query.includes("FROM principal_permission_grant")) {
        return [
          { principal_id: "security-1", reviewer_roles: ["Security"] },
          { principal_id: "platform-1", reviewer_roles: ["Platform"] },
        ];
      }
      throw new Error(`unexpected query: ${query}`);
    });

    const workflow = await repository.getApprovalWorkflowForContext({
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
    });

    expect(repository.approvalRulesFromWorkflow(workflow)).toEqual([
      { role: "Security", requiredCount: 1 },
      { role: "Platform", requiredCount: 1 },
    ]);
  });
});
