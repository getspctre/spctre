import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_TENANT_ID, DEMO_WORKSPACE_ID } from "../lib/demo";

const getWorkspaceContextSpy = vi.fn();
const getActiveActorSpy = vi.fn();
const ensureStarterPublishedBundleSpy = vi.fn();
const insertRuntimeEvidenceWithDedupSpy = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`redirect:${target}`);
  }),
}));

vi.mock("@/lib/workspace", () => ({ getWorkspaceContext: getWorkspaceContextSpy }));

vi.mock("@/lib/actors", () => ({
  getActiveActor: getActiveActorSpy,
  requireActorAdminWorkspace: () => ({ allowed: true }),
}));

vi.mock("@/lib/repositories/onboarding/shared", () => ({
  WEB_ONBOARDING_TOKEN_LABEL: "Web onboarding",
  WEB_ONBOARDING_TOKEN_SCOPES: ["evidence:write"],
  ensureStarterPublishedBundle: ensureStarterPublishedBundleSpy,
  recordWebOnboardingMilestone: vi.fn(),
}));

vi.mock("@/lib/repositories/evidence/runtime", () => ({
  insertRuntimeEvidenceWithDedup: insertRuntimeEvidenceWithDedupSpy,
}));

vi.mock("@/lib/service-tokens", () => ({ issueServiceAccountKey: vi.fn() }));

vi.mock("@/lib/domains/auth/service", () => ({ recordAuthOperation: vi.fn() }));

const quickStartActions = await import("../app/quick-start-actions");

describe("quick-start demo boundary", () => {
  beforeEach(() => {
    getWorkspaceContextSpy.mockReset();
    getActiveActorSpy.mockReset();
    ensureStarterPublishedBundleSpy.mockReset();
    insertRuntimeEvidenceWithDedupSpy.mockReset();
    getWorkspaceContextSpy.mockResolvedValue({
      tenantId: DEMO_TENANT_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      workspaceSlug: "workspace-demo",
    });
  });

  it("does not write sample allowed evidence for the demo tenant", async () => {
    const result = await quickStartActions.sendAllowedDecision(null, new FormData());

    expect(result).toEqual({
      error:
        "This action is read-only in Demo Mode. Create a free Spctre Cloud account to save changes!",
    });
    expect(getActiveActorSpy).not.toHaveBeenCalled();
    expect(ensureStarterPublishedBundleSpy).not.toHaveBeenCalled();
    expect(insertRuntimeEvidenceWithDedupSpy).not.toHaveBeenCalled();
  });

  it("does not write sample blocked evidence for the demo tenant", async () => {
    const result = await quickStartActions.sendBlockedDecision(null, new FormData());

    expect(result).toEqual({
      error:
        "This action is read-only in Demo Mode. Create a free Spctre Cloud account to save changes!",
    });
    expect(getActiveActorSpy).not.toHaveBeenCalled();
    expect(ensureStarterPublishedBundleSpy).not.toHaveBeenCalled();
    expect(insertRuntimeEvidenceWithDedupSpy).not.toHaveBeenCalled();
  });
});
