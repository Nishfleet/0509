import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  claimIssueSlot,
  countRecentIssues,
  deleteExpiredIssues,
  releaseIssueSlot,
} from "../../app/lib/data/support_issue.server";

/**
 * support_issue writer module (0509#7223): the ledger the support inbox cap
 * reads. Every row is a GitHub issue the inbox opened, so the cap counts opened
 * issues and not stored support reports. The claim is one statement, so two
 * mails that arrive together cannot both win the last slot.
 *
 * Real workerd and real local D1 with migrations/ applied.
 */

const NOW = new Date("2026-10-06T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const slot = (reportId: string, at = NOW.toISOString()) => ({ reportId, fromDomain: "sender.example", at });

const issueCount = async (): Promise<number> => {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM support_issue").first<{ n: number }>();
  return row?.n ?? 0;
};

describe("support_issue writer (0509#7223)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM support_issue");
  });

  it("(a) a claimed slot writes a row that countRecentIssues reads back", async () => {
    expect(await claimIssueSlot(env.DB, slot("sr-1"))).toBe(true);

    expect(await issueCount()).toBe(1);
    expect(await countRecentIssues(env.DB, "sender.example", NOW)).toBe(1);
  });

  it("(b) refuses the fourth claim inside the 24h window and keeps the first three", async () => {
    for (const reportId of ["sr-1", "sr-2", "sr-3"]) {
      expect(await claimIssueSlot(env.DB, slot(reportId))).toBe(true);
    }

    expect(await claimIssueSlot(env.DB, slot("sr-4"))).toBe(false);
    expect(await issueCount()).toBe(3);
  });

  it("(c) a released slot is free again and is not counted", async () => {
    await claimIssueSlot(env.DB, slot("sr-1"));
    await releaseIssueSlot(env.DB, "sr-1");

    expect(await countRecentIssues(env.DB, "sender.example", NOW)).toBe(0);
    expect(await claimIssueSlot(env.DB, slot("sr-2"))).toBe(true);
  });

  it("(d) does not count an issue opened outside the 24h window", async () => {
    const at = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
    expect(await claimIssueSlot(env.DB, slot("sr-old", at))).toBe(true);

    expect(await countRecentIssues(env.DB, "sender.example", NOW)).toBe(0);
    expect(await claimIssueSlot(env.DB, slot("sr-new"))).toBe(true);
  });

  it("(e) counts each sender domain on its own", async () => {
    for (const reportId of ["sr-1", "sr-2", "sr-3"]) {
      expect(await claimIssueSlot(env.DB, slot(reportId))).toBe(true);
    }
    const other = { reportId: "sr-4", fromDomain: "other.example", at: NOW.toISOString() };

    expect(await claimIssueSlot(env.DB, other)).toBe(true);
    expect(await countRecentIssues(env.DB, "other.example", NOW)).toBe(1);
  });

  it("(f) five concurrent claims open at most three", async () => {
    const results = await Promise.all(
      ["sr-1", "sr-2", "sr-3", "sr-4", "sr-5"].map((reportId) => claimIssueSlot(env.DB, slot(reportId))),
    );

    expect(results.filter((claimed) => claimed)).toHaveLength(3);
    expect(await issueCount()).toBe(3);
  });

  it("(g) deletes issue rows older than 90 days and keeps newer ones", async () => {
    await claimIssueSlot(env.DB, slot("sr-old", new Date(NOW.getTime() - 91 * DAY_MS).toISOString()));
    await claimIssueSlot(env.DB, slot("sr-edge", new Date(NOW.getTime() - 90 * DAY_MS).toISOString()));
    await claimIssueSlot(env.DB, slot("sr-new", new Date(NOW.getTime() - DAY_MS).toISOString()));

    expect(await deleteExpiredIssues(env.DB, NOW)).toBe(1);

    const rows = await env.DB.prepare("SELECT report_id FROM support_issue ORDER BY report_id").all<{
      report_id: string;
    }>();
    expect(rows.results.map((row) => row.report_id)).toEqual(["sr-edge", "sr-new"]);
  });

  it("(h) refuses the 21st claim across distinct domains", async () => {
    for (let i = 0; i < 20; i += 1) {
      expect(
        await claimIssueSlot(env.DB, {
          reportId: `sr-${String(i)}`,
          fromDomain: `d${String(i)}.example`,
          at: NOW.toISOString(),
        }),
      ).toBe(true);
    }

    expect(
      await claimIssueSlot(env.DB, {
        reportId: "sr-20",
        fromDomain: "d20.example",
        at: NOW.toISOString(),
      }),
    ).toBe(false);
    expect(await issueCount()).toBe(20);
  });

  it("(i) concurrent claims across domains open at most 20", async () => {
    const results = await Promise.all(
      Array.from({ length: 22 }, (_, i) =>
        claimIssueSlot(env.DB, {
          reportId: `sr-${String(i)}`,
          fromDomain: `d${String(i)}.example`,
          at: NOW.toISOString(),
        }),
      ),
    );

    expect(results.filter((claimed) => claimed)).toHaveLength(20);
    expect(await issueCount()).toBe(20);
  });
});
