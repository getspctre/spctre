// @vitest-environment jsdom
import React, { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ router: { refresh: vi.fn() }, save: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("../app/review/rule-actions", () => ({
  commitRuleRevision: mocks.save,
  evaluateExampleDecision: vi.fn(),
  simulateDraftDecision: vi.fn(),
}));
vi.mock("../app/quick-start-actions", () => ({
  sendAllowedDecision: vi.fn(),
  sendBlockedDecision: vi.fn(),
  generateOnboardingSetupToken: vi.fn(),
}));

import { RuleAuthoringPanel } from "../app/review/rule-authoring-panel";
import { QuickStartBanner } from "../app/quick-start-banner";
import { EvidenceSearchInspector } from "../app/evidence/evidence-search-inspector";
import { EvidenceTable } from "../app/evidence/evidence-table";
import { getEvidenceSearchQuery } from "../app/evidence/evidence-search";
import { Drawer } from "@spctre/ui";
import type { PolicyRuleSummary, RuntimeDecisionEvidenceRecord } from "@spctre/policy-schema";
import type { WebOnboardingStatus } from "../lib/repositories/onboarding/shared";

let container: HTMLDivElement;
let root: Root;
const rule: PolicyRuleSummary = {
  stableRuleId: "refund.limit",
  title: "Refund limit",
  effect: "DENY",
  sourceFormat: "AGT_YAML",
  domains: ["finance"],
  connectors: ["stripe"],
  actions: ["refund.create"],
  immutable: false,
};
const evidence: RuntimeDecisionEvidenceRecord = {
  decisionId: "decision-1",
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  environment: "production",
  runtimeTarget: { stack: "CUSTOM" },
  agentId: "refund-agent",
  connector: "stripe",
  action: "refund.create",
  status: "DENY",
  reason: "The refund exceeds the approved limit",
  policyRefs: ["refund.limit"],
  artifactHash: "hash-1",
  policyContext: [
    { branchId: "branch-1", revisionId: "revision-1", scope: "WORKSPACE", artifactHash: "hash-1" },
  ],
  latencyMs: 15,
  createdAt: "2026-09-14T13:45:23Z",
  rawEvidence: {},
};
const status = {
  quickStartEvidenceCount: 1,
  realEvidenceCount: 0,
  setupTokenExists: false,
  publishedBundle: { branchId: "branch-1", revisionId: "revision-1", artifactHash: "hash-1" },
} as WebOnboardingStatus;

async function render(element: React.ReactNode) {
  await act(async () => root.render(element));
}
async function click(element: Element) {
  await act(async () => (element as HTMLElement).click());
}
function button(text: string) {
  const found = Array.from(container.querySelectorAll("button")).find(
    (node) => node.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}
async function change(input: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype =
      input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  vi.stubGlobal("FormData", window.FormData);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) =>
    window.setTimeout(() => fn(0), 0),
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status }) }));
  vi.spyOn(window, "confirm").mockReturnValue(false);
  mocks.save
    .mockReset()
    .mockResolvedValue({ revisionId: "saved-2", sourceHash: "hash-2", ruleCount: 1 });
  mocks.router.refresh.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("policy authoring save workflow", () => {
  const editor = () =>
    h(RuleAuthoringPanel, {
      branchId: "branch-1",
      parentRevisionId: "revision-1",
      rules: [rule],
      viewMode: "executive",
    });
  it("saves the edited payload through the only persistence action and preserves saved status on refresh", async () => {
    await render(editor());
    expect(container.textContent).not.toContain("Create persisted draft revision");
    await click(
      container.querySelector(".ruleAuthoringTable tbody tr") ??
        container.querySelector("tbody tr")!,
    );
    const label = Array.from(container.querySelectorAll("label")).find(
      (node) => node.textContent?.trim() === "Title",
    )!;
    expect(label.control).toBeTruthy();
    await change(label.control as HTMLInputElement, "Updated refund limit");
    await click(button("Update working draft"));
    expect(container.textContent).toContain("Unsaved changes");
    expect(mocks.save).not.toHaveBeenCalled();
    // Even a server refresh with a new array identity must preserve local edits.
    await render(editor());
    expect(container.textContent).toContain("Updated refund limit");
    await click(button("Save draft"));
    const submitted = mocks.save.mock.calls[0][1] as FormData;
    expect(JSON.parse(String(submitted.get("rulesPayload")))[0].title).toBe("Updated refund limit");
    expect(container.textContent).toContain("All changes saved");
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
  });
  it("keeps rule edits when closing is declined and gives fields accessible label associations", async () => {
    await render(editor());
    await click(container.querySelector("tbody tr")!);
    const fields = Array.from(
      container.querySelectorAll(".ruleEditGrid input, .ruleEditGrid select"),
    );
    expect(fields.length).toBeGreaterThan(5);
    for (const field of fields)
      expect((field as HTMLInputElement).labels?.length).toBeGreaterThan(0);
    const title = Array.from(container.querySelectorAll("label")).find(
      (node) => node.textContent?.trim() === "Title",
    )!;
    await change(title.control as HTMLInputElement, "Keep this change");
    await click(button("Cancel"));
    expect(window.confirm).toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect((title.control as HTMLInputElement).value).toBe("Keep this change");
  });
  it("warns before navigation and never rebases unsaved edits onto a newer revision silently", async () => {
    await render(editor());
    await click(container.querySelector("tbody tr")!);
    const title = Array.from(container.querySelectorAll("label")).find(
      (node) => node.textContent?.trim() === "Title",
    )!;
    await change(title.control as HTMLInputElement, "My unsaved rules");
    await click(button("Update working draft"));
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    const link = document.createElement("a");
    link.href = "/other-page";
    container.append(link);
    const navigation = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(navigation);
    expect(navigation.defaultPrevented).toBe(true);
    expect(window.confirm).toHaveBeenCalled();
    await render(
      h(RuleAuthoringPanel, {
        branchId: "branch-1",
        parentRevisionId: "newer-revision",
        rules: [{ ...rule, title: "Another author's rules" }],
        viewMode: "executive",
      }),
    );
    expect(container.textContent).toContain("My unsaved rules");
    expect(container.textContent).toContain("A newer revision is available");
    expect(button("Save draft").disabled).toBe(true);
    vi.mocked(window.confirm).mockReturnValue(true);
    await click(container.querySelector('[aria-label="Discard unsaved changes"]')!);
    expect(container.textContent).toContain("Another author's rules");
    expect(container.textContent).toContain("All changes saved");
  });

  it("keeps a failed save dirty with the entered rules available for retry", async () => {
    mocks.save.mockResolvedValue({ error: "Unable to save. Try again." });
    await render(editor());
    await click(container.querySelector("tbody tr")!);
    const title = Array.from(container.querySelectorAll("label")).find(
      (node) => node.textContent?.trim() === "Title",
    )!;
    await change(title.control as HTMLInputElement, "Retry this change");
    await click(button("Update working draft"));
    await click(button("Save draft"));
    expect(container.textContent).toContain("Unsaved changes");
    expect(container.textContent).toContain("Retry this change");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Unable to save");
  });
});

describe("onboarding", () => {
  const banner = (overrides: Partial<WebOnboardingStatus> = {}) =>
    h(QuickStartBanner, {
      status: { ...status, ...overrides },
      workspaceSlug: "team",
      controlPlaneUrl: "https://example.test",
    });
  it("shows one selected integration path and reports copy failures", async () => {
    await render(banner());
    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.querySelector("pre")?.textContent).toContain("spctre init");
    expect(container.textContent).not.toContain("Generate setup token");
    await change(container.querySelector("select")!, "fetch");
    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.querySelector("pre")?.textContent).toContain("fetch(");
    expect(container.textContent).toContain("Generate setup token");
    await change(container.querySelector("select")!, "cli");
    await click(container.querySelector('button[aria-label="Copy CLI"]')!);
    expect(container.textContent).toContain("Copy failed");
  });
  it("recovers a transient starter failure and links to the actual policy page", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    await render(banner({ publishedBundle: null, quickStartEvidenceCount: 0 }));
    expect(container.textContent).toContain("Could not prepare the starter policy");
    expect(container.querySelector('a[href="/team/#branches"]')).not.toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: { ...status, quickStartEvidenceCount: 0 } }),
    } as Response);
    await click(button("Retry starter setup"));
    expect(container.textContent).toContain("Starter policy is published");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("explains a permission failure without claiming it is a connectivity problem", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 403 } as Response);
    await render(banner({ publishedBundle: null, quickStartEvidenceCount: 0 }));
    expect(container.textContent).toContain("An administrator must publish");
    expect(container.textContent).not.toContain("Retry starter setup");
  });
});

describe("evidence investigation", () => {
  it("opens full decision details from search and returns without losing entered filters", async () => {
    await render(
      h(EvidenceSearchInspector, {
        actionPath: "/team/evidence",
        defaultOpen: true,
        forensicMode: false,
        evidence: [evidence],
        workspaceSlug: "team",
        statuses: ["DENY"],
        runtimeStacks: ["CUSTOM"],
        searchResult: {
          query: {},
          results: [evidence],
          totalCount: 1,
          returnedCount: 1,
          deniedCount: 1,
          allowedCount: 0,
          warnedCount: 0,
          policyRefCount: 1,
        },
      }),
    );
    await change(container.querySelector('input[name="q"]')!, "refund");
    await click(button("Inspect decision"));
    expect(container.textContent).toContain("Decision trace");
    expect(container.querySelector('a[href="/team/rules?q=refund.limit"]')).not.toBeNull();
    await click(button("Back to search results"));
    expect((container.querySelector('input[name="q"]') as HTMLInputElement).value).toBe("refund");
    expect(container.querySelector('input[name="branch"]')?.getAttribute("list")).toBeTruthy();
  });
  it("keeps table-row semantics and displays unambiguous UTC timestamps", async () => {
    await render(h(EvidenceTable, { evidence: [evidence], viewMode: "executive" }));
    expect(container.querySelector("tbody tr")?.getAttribute("role")).toBeNull();
    expect(container.querySelector("time")?.textContent).toContain("UTC");
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
      "2026-09-14T13:45:23.000Z",
    );
    await click(
      container.querySelector('button[aria-label="Inspect stripe.refund.create by refund-agent"]')!,
    );
    expect(container.textContent).toContain(evidence.reason);
  });
  it("starts searches without an implicit vendor or denial filter", () => {
    expect(getEvidenceSearchQuery({})).toMatchObject({
      text: undefined,
      statuses: undefined,
      connectors: undefined,
    });
  });
});

describe("drawer keyboard behavior", () => {
  it("contains initial reverse-tab, ignores hidden controls, and does not reset focus when callbacks change", async () => {
    const draw = () =>
      h(
        Drawer,
        { open: true, title: "Edit", onClose: () => undefined },
        h("input", { "aria-label": "Name" }),
        h("div", { hidden: true }, h("button", null, "Hidden")),
      );
    await render(draw());
    const close = container.querySelector(".slideOutHeader button")!;
    expect(document.activeElement).toBe(close);
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true }),
      ),
    );
    const input = container.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    await render(draw());
    expect(document.activeElement).toBe(input);
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true })),
    );
    expect(document.activeElement).toBe(close);
  });
});
