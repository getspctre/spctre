import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  sql: sqlMock,
}));

const repository = await import("../lib/repositories/policy/branches");

describe("policy branches repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates branch authors from principal display names", async () => {
    sqlMock.mockResolvedValueOnce([
      {
        id: "br-workspace",
        name: "workspace",
        scope: "WORKSPACE",
        environment: null,
        connector: null,
        active_revision_id: "rev-workspace",
        created_by: "00000000-0000-0000-0000-000000000013",
        author_display_name: "Maya Security",
        author_email: "maya@spctre.local",
        message: "Import via Spctre control plane",
        is_published: true,
        has_approvals: false,
      },
    ]);

    const branches = await repository.listBranches("workspace-1", "tenant-1");

    expect(branches[0]).toMatchObject({
      id: "br-workspace",
      author: "Maya Security",
    });
  });

  it("falls back to raw branch author IDs when no principal matches", async () => {
    sqlMock.mockResolvedValueOnce([
      {
        id: "br-workspace",
        name: "workspace",
        scope: "WORKSPACE",
        environment: null,
        connector: null,
        active_revision_id: "rev-workspace",
        created_by: "system",
        author_display_name: null,
        author_email: null,
        message: "Seeded policy",
        is_published: false,
        has_approvals: false,
      },
    ]);

    const branches = await repository.listBranches("workspace-1", "tenant-1");

    expect(branches[0]?.author).toBe("system");
  });
});
