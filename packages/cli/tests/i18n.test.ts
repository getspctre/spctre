import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configSet } from "../src/config-command";
import { readStoredConfig, writeConfig } from "../src/config";
import { detectCliLocale, isSupportedLocaleInput, L10nManager, normalizeLocale } from "../src/i18n";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("CLI localization", () => {
  it("normalizes locale variants without region-specific catalog splits", () => {
    expect(normalizeLocale("ja_JP.UTF-8")).toBe("ja");
    expect(normalizeLocale("fr-CA")).toBe("fr");
    expect(normalizeLocale("pt-BR")).toBe("en");
    expect(isSupportedLocaleInput("pt-BR")).toBe(false);
  });

  it("prefers persistent config locale over shell locale", () => {
    vi.stubEnv("LANG", "de_DE.UTF-8");
    expect(detectCliLocale({ locale: "ja" })).toBe("ja");
  });

  it("formats localized diagnostics with metadata placeholders", () => {
    const l10n = new L10nManager("de-DE");
    expect(
      l10n.format("diagnostics.unknownConnector", {
        connector: "github",
        suggestion: "  did you mean \"gitlab\"?",
      })
    ).toContain("github");
  });

  it("persists locale preferences without dropping existing config values", async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-cli-i18n-"));
    vi.stubEnv("SPCTRE_CONFIG_DIR", configDir);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    writeConfig({
      controlPlaneUrl: "https://control.example",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      workspaceSlug: "default",
      agentId: "agent-1",
      environment: "prod",
      token: "secret",
      tokenId: "token-1",
      tokenExpiresAt: "2026-07-10T00:00:00.000Z",
      artifactHash: "sha256:test",
      branchId: "branch-1",
      revisionId: "revision-1",
      bundlePath: "spctre-policy.json",
      policyContext: [],
    });

    await configSet("locale", "fr-CA");

    expect(readStoredConfig()).toMatchObject({
      controlPlaneUrl: "https://control.example",
      tenantId: "tenant-1",
      locale: "fr",
    });
  });
});
