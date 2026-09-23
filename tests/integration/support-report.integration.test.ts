import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  deleteExpiredSupportReports,
  insertSupportReport,
} from "../../app/lib/data/support_report.server";

/**
 * support_report writer module (0509#4229 child 1).
 *
 * The table stores raw inbound support mail for 90 days; the writer module
 * inserts a report and deletes rows older than the retention window, which is
 * measured from the caller's `now` so the test can pin it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-23T00:00:00.000Z");

const insertReport = (id: string, receivedAt: string, raw: string) =>
  insertSupportReport(env.DB, {
    id,
    receivedAt,
    fromDomain: "sender.example",
    subjectSha256: "0".repeat(64),
    raw,
  });

describe("support_report writer (0509#4229)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM support_report");
  });

  it("(a) inserts a report whose raw body reads back unchanged", async () => {
    await insertReport("sr-1", NOW.toISOString(), "raw report body");

    const row = await env.DB.prepare("SELECT raw FROM support_report WHERE id = ?")
      .bind("sr-1")
      .first<{ raw: string }>();

    expect(row?.raw).toBe("raw report body");
  });

  it("(b) deletes reports older than 90 days and keeps newer ones", async () => {
    await insertReport("sr-old", new Date(NOW.getTime() - 91 * DAY_MS).toISOString(), "old");
    await insertReport("sr-new", new Date(NOW.getTime() - DAY_MS).toISOString(), "new");

    expect(await deleteExpiredSupportReports(env.DB, NOW)).toBe(1);

    const remaining = await env.DB.prepare("SELECT id FROM support_report").all<{
      id: string;
    }>();
    expect(remaining.results.map((r) => r.id)).toEqual(["sr-new"]);
  });
});
