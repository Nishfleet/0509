import { describe, expect, it } from "vitest";

import {
  buildEvidenceUsageQuery,
  buildSignupsQuery,
  buildTopUpsQuery,
  buildYieldPerWatchlistQuery,
  buildYieldWeeklyQuery,
} from "../scripts/weekly-business-metrics.mjs";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const isoDaysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

describe("weekly business-metrics windowed series", () => {
  it("floors the signups series at now - signupDays so stale rows never appear under 'last 14 days'", () => {
    const sql = buildSignupsQuery(NOW);
    expect(sql).toContain(`WHERE createdAt >= '${isoDaysAgo(14)}'`);
    expect(sql).toContain("LIMIT 14");
  });

  it("floors the top-up series at now - topUpDays", () => {
    const sql = buildTopUpsQuery(NOW);
    expect(sql).toContain(`WHERE granted_at >= '${isoDaysAgo(14)}'`);
    expect(sql).toContain("LIMIT 14");
  });

  it("floors the evidence-usage series at now - usagePeriods months", () => {
    const sql = buildEvidenceUsageQuery(NOW);
    expect(sql).toContain(`WHERE period_start >= '2025-09-10T12:00:00.000Z'`);
    expect(sql).toContain("LIMIT 12");
  });

  it("floors the weekly yield series at now - yieldWeeks * 7 days", () => {
    const sql = buildYieldWeeklyQuery(NOW);
    expect(sql).toContain(`we.created_at >= '${isoDaysAgo(84)}'`);
    expect(sql).toContain("LIMIT 12");
  });

  it("keeps the per-watchlist yield query floored at the trailing 7 days", () => {
    const sql = buildYieldPerWatchlistQuery(NOW);
    expect(sql).toContain(`we.created_at >= '${isoDaysAgo(7)}'`);
  });
});
