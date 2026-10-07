import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { countRecentSupportReports } from "../../../app/lib/data/support_report.server";

const NOW = new Date("2026-09-24T00:00:00.000Z");
const RECEIVED_AT = "2026-09-23T18:00:00.000Z";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM support_report");
});

describe("countRecentSupportReports", () => {
  it("counts a report received in the last 24 hours", async () => {
    await env.DB.prepare(
      `INSERT INTO support_report (id, received_at, from_domain, subject_sha256, raw)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind("sr-recent", RECEIVED_AT, "sender.example", "0".repeat(64), "raw")
      .run();

    expect(await countRecentSupportReports(env.DB, "sender.example", NOW)).toBe(1);
  });
});
