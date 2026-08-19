import { describe, expect, it } from "vitest";

import { FACT_RAIL_MAX_ROWS } from "~/components/evidence/fact-rail";
import type { WatchlistProofSummary, WatchlistRunRecord } from "~/lib/types";
import {
  buildCompetitorDeliveryLines,
  buildCompetitorFactRows,
  countHardFailuresSinceLastSuccess,
  formatCaughtNote,
  formatCaughtNumber,
  formatEvidenceAttempts,
  formatLastCheck,
  formatWatchAge,
  formatWatchMarket,
} from "~/lib/watchlist-detail-display";

function run(
  status: WatchlistRunRecord["status"],
  errorCode: string | null = null,
): Pick<WatchlistRunRecord, "status" | "errorCode"> {
  return { status, errorCode };
}

const emptyProof: WatchlistProofSummary = {
  totalAttempts: 0,
  successfulAttempts: 0,
  failedAttempts: 0,
  skippedAttempts: 0,
  lastAttemptAt: null,
  lastSuccessfulProofAt: null,
};

describe("countHardFailuresSinceLastSuccess — one failure definition (BL-006/BL-007)", () => {
  it("counts hard failures newest-first until the last success closes the window", () => {
    expect(
      countHardFailuresSinceLastSuccess([
        run("failed"),
        run("failed"),
        run("succeeded"),
        run("failed"),
      ]),
    ).toBe(2);
  });

  it("does NOT stop at an intervening skipped or pending run — the board's SQL does not either", () => {
    // The pre-BL-007 detail banner broke at the first non-failed run, so this
    // watchlist reported 1 on the detail and 3 on the board. Same page, same
    // competitor, two numbers.
    expect(
      countHardFailuresSinceLastSuccess([
        run("failed"),
        run("skipped", "capacity_budget"),
        run("failed"),
        run("pending"),
        run("failed"),
        run("succeeded"),
      ]),
    ).toBe(3);
  });

  it("never counts provider cooldowns — a rate limit is not broken tracking", () => {
    expect(
      countHardFailuresSinceLastSuccess([
        run("failed", "rate_limited"),
        run("failed", "cache_only"),
        run("failed", "browser_launch_failed"),
      ]),
    ).toBe(1);
  });

  it("is zero for an empty history and for a clean history", () => {
    expect(countHardFailuresSinceLastSuccess([])).toBe(0);
    expect(countHardFailuresSinceLastSuccess([run("succeeded"), run("failed")])).toBe(0);
    expect(countHardFailuresSinceLastSuccess([run("running"), run("succeeded")])).toBe(0);
  });
});

describe("the number card (brief §7)", () => {
  it("prints the captured count, never a negative or a fraction", () => {
    expect(formatCaughtNumber(0)).toBe("0");
    expect(formatCaughtNumber(4)).toBe("4");
    expect(formatCaughtNumber(-2)).toBe("0");
    expect(formatCaughtNumber(2.8)).toBe("2");
  });

  it("states a quiet run as a finding, not a gap", () => {
    expect(
      formatCaughtNote({
        capturedChanges: 0,
        windowDays: 30,
        lastScannedAt: "2026-07-26T04:00:00.000Z",
        isActive: true,
      }),
    ).toBe("Checked, and nothing has changed in 30 days. That is the finding.");
  });

  it("degrades honestly before the first capture, and when paused", () => {
    expect(
      formatCaughtNote({
        capturedChanges: 0,
        windowDays: 30,
        lastScannedAt: null,
        isActive: true,
      }),
    ).toContain("No completed check yet");
    expect(
      formatCaughtNote({
        capturedChanges: 5,
        windowDays: 30,
        lastScannedAt: "2026-07-26T04:00:00.000Z",
        isActive: false,
      }),
    ).toContain("Paused");
  });

  it("counts changes in words the customer can check", () => {
    expect(
      formatCaughtNote({
        capturedChanges: 1,
        windowDays: 30,
        lastScannedAt: "2026-07-26T04:00:00.000Z",
        isActive: true,
      }),
    ).toBe("One change captured in the last 30 days.");
    expect(
      formatCaughtNote({
        capturedChanges: 3,
        windowDays: 30,
        lastScannedAt: "2026-07-26T04:00:00.000Z",
        isActive: true,
      }),
    ).toBe("3 changes captured in the last 30 days.");
  });
});

describe("fact rail rows (brief §6.6)", () => {
  const now = new Date("2026-07-27T09:00:00.000Z");

  it("stays inside the eight-row ceiling", () => {
    const rows = buildCompetitorFactRows({
      targetLabel: "Okara",
      targetCountry: "IN",
      trackingRole: "competitor",
      isActive: true,
      plan: "starter",
      createdAt: "2026-07-01T09:00:00.000Z",
      lastScannedAt: "2026-07-27T08:01:00.000Z",
      now,
      proofSummary: { ...emptyProof, totalAttempts: 3, successfulAttempts: 2, failedAttempts: 1 },
      storedChanges: 4,
    });
    expect(rows.length).toBeLessThanOrEqual(FACT_RAIL_MAX_ROWS);
    expect(new Map(rows.map((row) => [row.key, row])).get("Last check")?.value).toBe("59m ago");
  });

  it("keeps a row for every unknown value instead of dropping it", () => {
    const rows = buildCompetitorFactRows({
      targetLabel: "Okara",
      targetCountry: null,
      trackingRole: null,
      isActive: false,
      plan: "free",
      createdAt: null,
      lastScannedAt: null,
      now,
      proofSummary: emptyProof,
      storedChanges: 0,
    });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    expect(byKey.get("Market")?.value).toBeNull();
    expect(byKey.get("Market")?.missingLabel).toBe("not set — scanned as first saved");
    expect(byKey.get("Watch age")?.value).toBeNull();
    expect(byKey.get("Last check")?.missingLabel).toBe("none yet");
    expect(byKey.get("Proof captures")?.missingLabel).toBe("none yet");
    expect(byKey.get("Changes on file")?.missingLabel).toBe("none yet");
    expect(byKey.get("Cadence")?.value).toBe("Paused — no checks run");
    expect(byKey.get("Tracked as")?.value).toBe("Competitor");
  });

  it("formats markets, watch age and evidence tallies without inventing any of them", () => {
    expect(formatWatchMarket("all")).toBe("Every market");
    expect(formatWatchMarket("  ")).toBeNull();
    expect(formatWatchAge("2026-07-27T00:00:00.000Z", now)).toBe("Added today");
    expect(formatWatchAge("2026-07-26T00:00:00.000Z", now)).toBe("Watching 1 day");
    expect(formatWatchAge("2026-07-01T00:00:00.000Z", now)).toBe("Watching 26 days");
    expect(formatWatchAge("not-a-date", now)).toBeNull();
    expect(formatLastCheck("2026-07-27T08:01:00.000Z", now)).toBe("59m ago");
    expect(formatLastCheck("2026-07-25T08:01:00.000Z", now)).toBe("2d ago");
    expect(formatLastCheck("not-a-date", now)).toBeNull();
    expect(formatEvidenceAttempts(emptyProof)).toBeNull();
    expect(
      formatEvidenceAttempts({
        ...emptyProof,
        totalAttempts: 4,
        successfulAttempts: 2,
        failedAttempts: 1,
        skippedAttempts: 1,
      }),
    ).toBe("2 good · 1 failed · 1 skipped");
  });
});

describe("the rail delivery card (brief §7)", () => {
  it("states the policy in words, including quiet hours and who the recipients are", () => {
    const lines = buildCompetitorDeliveryLines({
      emailEnabled: true,
      canEmailDelivery: true,
      instantEnabled: true,
      digestEnabled: false,
      quietHours: { startHour: 22, endHour: 8 },
      timezone: "Asia/Kolkata",
      targetCount: 2,
      canManageDelivery: true,
    });
    const byKey = new Map(lines.map((line) => [line.key, line.value]));
    expect(byKey.get("Email")).toBe("On");
    expect(byKey.get("Digest")).toBe("Off");
    expect(byKey.get("Quiet hours")).toBe("22:00–08:00 Asia/Kolkata");
    expect(byKey.get("Recipients")).toBe("2 addresses for this competitor");
  });

  it("says the workspace default is in use rather than pretending there is none", () => {
    const lines = buildCompetitorDeliveryLines({
      emailEnabled: false,
      canEmailDelivery: true,
      instantEnabled: false,
      digestEnabled: true,
      quietHours: null,
      timezone: null,
      targetCount: 0,
      canManageDelivery: true,
    });
    const byKey = new Map(lines.map((line) => [line.key, line.value]));
    expect(byKey.get("Recipients")).toBe("Workspace default address");
    expect(lines.some((line) => line.key === "Quiet hours")).toBe(false);
  });

  it("tells a member who owns delivery instead of showing them a count they cannot change", () => {
    const lines = buildCompetitorDeliveryLines({
      emailEnabled: true,
      canEmailDelivery: true,
      instantEnabled: false,
      digestEnabled: true,
      quietHours: null,
      timezone: null,
      targetCount: 0,
      canManageDelivery: false,
    });
    expect(lines.find((line) => line.key === "Recipients")?.value).toBe(
      "Managed by the workspace owner",
    );
  });

  it("never claims email is on when the plan has no email delivery", () => {
    const lines = buildCompetitorDeliveryLines({
      emailEnabled: true,
      canEmailDelivery: false,
      instantEnabled: false,
      digestEnabled: true,
      quietHours: null,
      timezone: null,
      targetCount: 1,
      canManageDelivery: true,
    });
    expect(lines.find((line) => line.key === "Email")?.value).toBe(
      "Off — requires Scout",
    );
  });
});
