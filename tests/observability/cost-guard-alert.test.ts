import { captureMessage } from "@sentry/cloudflare";
import { beforeEach, describe, expect, it, vi } from "vitest";

const inserted = vi.hoisted(() => ({ ids: [] as string[] }));
const analytics = vi.hoisted(() => ({
  usage: { day: "2026-09-22", d1RowsWritten: 0, r2ClassAOps: 0, r2StoredBytes: 0 },
}));

vi.mock("@sentry/cloudflare", () => ({ captureMessage: vi.fn() }));
vi.mock("../../app/lib/data/cost_alert.server", () => ({ insertCostAlerts: () => Promise.resolve(inserted.ids) }));
vi.mock("../../app/lib/site/browser-budget.server", () => ({ readBrowserMsForDay: () => Promise.resolve(10_000_000) }));
vi.mock("../../app/lib/observability/cost-analytics.server", () => ({
  fetchDailyUsage: () => Promise.resolve(analytics.usage),
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
  analytics.usage = { day: "2026-09-22", d1RowsWritten: 0, r2ClassAOps: 0, r2StoredBytes: 0 };
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
      fingerprint: ["cost-guard-breach", "2026-09-22"],
      extra: { breaches: [{ line: "browser_ms_0509", measured: 10_000_000, limit: 45_000, onBrands: 1 }] },
    });
    expect(captureMessage).toHaveBeenCalledTimes(2);
  });

  it("opens a separate Sentry issue for each day so a later breach is not folded into an earlier one", async () => {
    inserted.ids = ["alert-1"];

    await runCostGuard(db, undefined, "2026-09-23");

    expect(captureMessage).toHaveBeenCalledWith(
      "cost guard breach on 2026-09-23: browser_ms_0509",
      expect.objectContaining({ fingerprint: ["cost-guard-breach", "2026-09-23"] }),
    );
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

describe("an account-wide breach", () => {
  it("names only the day and the lines in the message and carries the numbers in extra", async () => {
    inserted.ids = ["alert-1"];
    analytics.usage = { day: "2026-09-22", d1RowsWritten: 1_800_000, r2ClassAOps: 0, r2StoredBytes: 31_000_000_000 };

    await runCostGuard(db, "token", "2026-09-22");

    expect(captureMessage).toHaveBeenCalledExactlyOnceWith(
      "cost guard breach on 2026-09-22: d1_rows_written_account, r2_stored_bytes_account, browser_ms_0509",
      {
        level: "error",
        fingerprint: ["cost-guard-breach", "2026-09-22"],
        extra: {
          breaches: [
            { line: "d1_rows_written_account", measured: 1_800_000, limit: 1_500_000, onBrands: 1 },
            { line: "r2_stored_bytes_account", measured: 31_000_000_000, limit: 30_000_000_000, onBrands: 1 },
            { line: "browser_ms_0509", measured: 10_000_000, limit: 45_000, onBrands: 1 },
          ],
        },
      },
    );
  });

  it("leaves the Cloudflare lines out of the message when D1 and R2 are far under their limits", async () => {
    inserted.ids = ["alert-1"];
    analytics.usage = { day: "2026-09-22", d1RowsWritten: 227_324, r2ClassAOps: 0, r2StoredBytes: 22_000_000_000 };

    await runCostGuard(db, "token", "2026-09-22");

    expect(captureMessage).toHaveBeenCalledExactlyOnceWith(
      "cost guard breach on 2026-09-22: browser_ms_0509",
      expect.objectContaining({ fingerprint: ["cost-guard-breach", "2026-09-22"] }),
    );
  });
});
