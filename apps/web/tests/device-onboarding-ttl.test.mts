import { beforeEach, describe, expect, it, vi } from "vitest";

const inserted: { expiresAt: string }[] = [];

// The insert is a tagged template, so capture the interpolated expiry by
// position rather than by parsing the SQL.
const rawSql = Object.assign(
  vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    const expiresAt = values.find(
      (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value),
    );
    if (typeof expiresAt === "string") inserted.push({ expiresAt });
    return [];
  }),
  {},
);

vi.mock("@/lib/db", () => ({ rawSql, sql: rawSql }));
vi.mock("@/lib/repositories/seed/local-dev", () => ({ ensureDemoTenant: async () => {} }));
vi.mock("./cli", () => ({}));

const { startDeviceOnboarding } = await import("@/lib/repositories/onboarding/device");
const { ONBOARDING_TTL_MINUTES, TRIAL_ONBOARDING_TTL_MINUTES } =
  await import("@/lib/repositories/onboarding/shared");

const base = {
  controlPlaneUrl: "https://app.example.test",
  agentId: "solo-agent",
  environment: "production",
  bundlePath: "spctre-policy.json",
};

function minutesUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
}

beforeEach(() => {
  inserted.length = 0;
  rawSql.mockClear();
});

describe("device onboarding lifetime", () => {
  it("gives an ordinary login the standard window", async () => {
    const started = await startDeviceOnboarding(base);

    expect(started.expiresIn).toBe(ONBOARDING_TTL_MINUTES * 60);
    expect(minutesUntil(inserted[0].expiresAt)).toBe(ONBOARDING_TTL_MINUTES);
  });

  it("gives a trial request longer, to absorb signup and an emailed link", async () => {
    const started = await startDeviceOnboarding({ ...base, trial: true });

    expect(started.expiresIn).toBe(TRIAL_ONBOARDING_TTL_MINUTES * 60);
    expect(minutesUntil(inserted[0].expiresAt)).toBe(TRIAL_ONBOARDING_TTL_MINUTES);
  });

  /**
   * The magic link is what carries a new operator back to the approval, so an
   * approval that outlived it could never be reached — and one that expires
   * first hands them a working link to a dead code, which is the trap this
   * window exists to close.
   */
  it("does not outlive the magic link that returns the operator to it", async () => {
    const { MAGIC_LINK_TTL_SECONDS } = await import("@/lib/domains/auth/magic-link");

    expect(TRIAL_ONBOARDING_TTL_MINUTES * 60).toBeLessThanOrEqual(MAGIC_LINK_TTL_SECONDS);
  });
});
