import { captureMessage } from "@sentry/cloudflare";
import { beforeEach, describe, expect, it, vi } from "vitest";

const inserted = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("@sentry/cloudflare", () => ({ captureMessage: vi.fn() }));
vi.mock("../../app/lib/data/cost_alert.server", () => ({ insertCostAlerts: () => Promise.resolve(inserted.ids) }));
vi.mock("../../app/lib/site/browser-budget.server", () => ({ readBrowserMsForDay: () => Promise.resolve(10_000_000) }));
vi.mock("../../app/lib/observability/cost-analytics.server", () => ({
  fetchDailyUsage: () => Promise.resolve({ day: "2026-09-22", d1RowsWritten: 0, r2ClassAOps: 0 }),
}));

import { runCostGuard } from "../../app/lib/observability/run-cost-guard.server";

const db = {
  prepare: () => ({
    bind: () => ({ first: () => Promise.resolve({ n: 1 }) }),
    first: () => Promise.resolve({ n: 1 }),
  }),
} as unknown as D1Database;

beforeEach(() => {
  vi.mocked(captureMessage).mockClear();
});

describe("a cost-guard breach", () => {
  it("goes to Sentry once, naming only the day and the lines", async () => {
    inserted.ids = ["alert-1"];

    await runCostGuard(db, undefined, "2026-09-22");

    expect(captureMessage).toHaveBeenCalledWith("cost guard skipped D1 and R2: CLOUDFLARE_API_TOKEN unset", {
      level: "error",
      fingerprint: ["cost-guard-token-missing"],
    });
    expect(captureMessage).toHaveBeenCalledWith("cost guard breach on 2026-09-22: browser_ms_0509", {
      level: "error",
      fingerprint: ["cost-guard-breach"],
    });
    expect(captureMessage).toHaveBeenCalledTimes(2);
  });

  it("still flags a missing token when a breach row already existed", async () => {
    inserted.ids = [];

    await runCostGuard(db, undefined, "2026-09-22");

    expect(captureMessage).toHaveBeenCalledExactlyOnceWith("cost guard skipped D1 and R2: CLOUDFLARE_API_TOKEN unset", {
      level: "error",
      fingerprint: ["cost-guard-token-missing"],
    });
  });

  it("does not flag a missing token when the analytics token is present", async () => {
    inserted.ids = [];

    await runCostGuard(db, "token", "2026-09-22");

    expect(captureMessage).not.toHaveBeenCalled();
  });
});
