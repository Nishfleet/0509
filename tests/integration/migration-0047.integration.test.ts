import { env, type D1Migration } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { isAddressSuppressed } from "../../app/lib/data/email_suppression.server";

// migrations/0047_email_suppression_normalize.sql (0509#7128). The lookup now matches
// the primary key exactly, so a suppression stored before the fix with capitals or
// spaces is only found if this migration rewrote it. Its own file so the statements
// run against the rows seeded here and nothing else.

interface Row {
  address: string;
  reason: string;
  created_at: string;
}

const LEGACY: Row[] = [
  { address: "Solo@0509.io", reason: "unsubscribed", created_at: "2026-09-25T00:00:00Z" },
  { address: "already@0509.io", reason: "unsubscribed", created_at: "2026-09-26T00:00:00Z" },
  { address: "Pair@0509.io", reason: "unsubscribed", created_at: "2026-09-28T00:00:00Z" },
  { address: " PAIR@0509.io ", reason: "workspace_deleted", created_at: "2026-09-21T00:00:00Z" },
  { address: "kept@0509.io", reason: "unsubscribed", created_at: "2026-09-30T00:00:00Z" },
  { address: "Kept@0509.io", reason: "workspace_deleted", created_at: "2026-09-20T00:00:00Z" },
  { address: "later@0509.io", reason: "unsubscribed", created_at: "2026-09-20T00:00:00Z" },
  { address: "LATER@0509.io", reason: "workspace_deleted", created_at: "2026-09-29T00:00:00Z" },
];

function migrationQueries(): string[] {
  const found: D1Migration | undefined = env.TEST_MIGRATIONS.find((migration) =>
    migration.name.endsWith("_email_suppression_normalize.sql"),
  );
  if (found === undefined) throw new Error("0047_email_suppression_normalize.sql is missing from TEST_MIGRATIONS");
  return found.queries;
}

async function runMigration(): Promise<void> {
  for (const query of migrationQueries()) await env.DB.prepare(query).run();
}

async function rows(): Promise<Row[]> {
  const { results } = await env.DB.prepare(
    "SELECT address, reason, created_at FROM email_suppression ORDER BY address",
  ).all<Row>();
  return results;
}

describe("the 0047 email_suppression normalization", () => {
  it("lowercases every address, collapses case duplicates to the earliest, and keeps every suppression", async () => {
    await env.DB.exec("DELETE FROM email_suppression");
    await env.DB.batch(
      LEGACY.map((row) =>
        env.DB.prepare("INSERT INTO email_suppression (address, reason, created_at) VALUES (?, ?, ?)").bind(
          row.address,
          row.reason,
          row.created_at,
        ),
      ),
    );

    await runMigration();
    await runMigration();

    expect(await rows()).toEqual([
      { address: "already@0509.io", reason: "unsubscribed", created_at: "2026-09-26T00:00:00Z" },
      { address: "kept@0509.io", reason: "workspace_deleted", created_at: "2026-09-20T00:00:00Z" },
      { address: "later@0509.io", reason: "unsubscribed", created_at: "2026-09-20T00:00:00Z" },
      { address: "pair@0509.io", reason: "workspace_deleted", created_at: "2026-09-21T00:00:00Z" },
      { address: "solo@0509.io", reason: "unsubscribed", created_at: "2026-09-25T00:00:00Z" },
    ]);

    for (const address of ["SOLO@0509.io", "Pair@0509.io", " kept@0509.io", "Later@0509.io", "Already@0509.io"]) {
      expect(await isAddressSuppressed(address)).toBe(true);
    }
    expect(await isAddressSuppressed("never@0509.io")).toBe(false);
  });
});
