import { describe, expect, it } from "vitest";
import { buildWorkspaceSwitchPath } from "../lib/workspace/path";

describe("buildWorkspaceSwitchPath", () => {
  const knownWorkspaceSlugs = ["acquisition-outreach", "acquisition-scout"];

  it("replaces the workspace slug and preserves the scoped page and query", () => {
    expect(buildWorkspaceSwitchPath({
      workspaceSlug: "acquisition-scout",
      pathname: "/acquisition-outreach/simulate",
      search: "sim_run=run-123",
      knownWorkspaceSlugs,
    })).toBe("/acquisition-scout/simulate?sim_run=run-123");
  });

  it("canonicalizes a bare workspace route for the selected workspace", () => {
    expect(buildWorkspaceSwitchPath({
      workspaceSlug: "acquisition-scout",
      pathname: "/review",
      search: "branch=branch-123",
      knownWorkspaceSlugs,
    })).toBe("/acquisition-scout/review?branch=branch-123");
  });

  it("uses the selected workspace home from a global route", () => {
    expect(buildWorkspaceSwitchPath({
      workspaceSlug: "acquisition-scout",
      pathname: "/admin/workspace",
      search: "tab=settings",
      knownWorkspaceSlugs,
    })).toBe("/acquisition-scout?tab=settings");
  });
});
