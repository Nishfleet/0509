import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { deleteExpiredAuthRows } from "../../app/lib/data/auth_expiry.server";

const NOW = new Date("2026-09-25T03:00:00.000Z");
const EXPIRED_AT = "2026-09-24T03:00:00.000Z";
const LIVE_AT = "2026-09-26T03:00:00.000Z";

const seedUser = async () => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES ('user-auth-expiry', 'Reader', 'reader-expiry@0509.io', 1, ?, ?)`,
  )
    .bind(NOW.toISOString(), NOW.toISOString())
    .run();
};

const seedSession = async (id: string, expiresAt: string) => {
  await env.DB.prepare(
    `INSERT INTO "session" (id, "expiresAt", token, "createdAt", "updatedAt", "ipAddress", "userAgent", "userId")
     VALUES (?, ?, ?, ?, ?, '203.0.113.10', 'test-agent', 'user-auth-expiry')`,
  )
    .bind(id, expiresAt, `token-${id}`, NOW.toISOString(), NOW.toISOString())
    .run();
};

const seedVerification = async (id: string, expiresAt: string) => {
  await env.DB.prepare(
    `INSERT INTO "verification" (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
     VALUES (?, 'magic-link:reader-expiry@0509.io', ?, ?, ?, ?)`,
  )
    .bind(id, `value-${id}`, expiresAt, NOW.toISOString(), NOW.toISOString())
    .run();
};

const remainingIds = async (table: "session" | "verification") =>
  (
    await env.DB.prepare(`SELECT id FROM "${table}" ORDER BY id ASC`).all<{ id: string }>()
  ).results.map((row) => row.id);

describe("auth expiry sweep (0509#4738)", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM "session"`).run();
    await env.DB.prepare(`DELETE FROM "verification"`).run();
    await env.DB.prepare(`DELETE FROM "user"`).run();
  });

  it("deletes the expired session and verification rows and keeps the live ones", async () => {
    await seedUser();
    await seedSession("session-expired", EXPIRED_AT);
    await seedSession("session-live", LIVE_AT);
    await seedVerification("verification-expired", EXPIRED_AT);
    await seedVerification("verification-live", LIVE_AT);

    const result = await deleteExpiredAuthRows(env.DB, NOW);

    expect(result).toEqual({ sessions: 1, verifications: 1 });
    expect(await remainingIds("session")).toEqual(["session-live"]);
    expect(await remainingIds("verification")).toEqual(["verification-live"]);
  });
});
