import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readDevices } from "../../app/lib/data/session.server";

const NOW = new Date("2026-10-14T08:00:00.000Z");

const seedSession = (input: { id: string; user: string; expiresAt: string; updatedAt: string; agent: string | null }) =>
  env.DB.prepare(
    `INSERT INTO "session" (id, "expiresAt", token, "createdAt", "updatedAt", "ipAddress", "userAgent", "userId")
     VALUES (?, ?, ?, '2026-10-01T00:00:00.000Z', ?, '203.0.113.10', ?, ?)`,
  )
    .bind(input.id, input.expiresAt, `token-${input.id}`, input.updatedAt, input.agent, input.user)
    .run();

describe("signed-in devices", () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM "session"');
    await env.DB.exec('DELETE FROM "user"');
    for (const id of ["user-devices-a", "user-devices-b"]) {
      await env.DB.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (?, 'Devices', ?, 1, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      )
        .bind(id, `${id}@0509.io`)
        .run();
    }
  });

  it("lists this account's live sessions, newest first, and nothing else", async () => {
    await seedSession({
      id: "old",
      user: "user-devices-a",
      expiresAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-10-05T00:00:00.000Z",
      agent: "UA one",
    });
    await seedSession({
      id: "new",
      user: "user-devices-a",
      expiresAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-10-13T00:00:00.000Z",
      agent: null,
    });
    await seedSession({
      id: "expired",
      user: "user-devices-a",
      expiresAt: "2026-10-10T00:00:00.000Z",
      updatedAt: "2026-10-09T00:00:00.000Z",
      agent: "UA two",
    });
    await seedSession({
      id: "someone-else",
      user: "user-devices-b",
      expiresAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-10-13T00:00:00.000Z",
      agent: "UA three",
    });

    const devices = await readDevices(env.DB, "user-devices-a", NOW);

    expect(devices.map((device) => device.id)).toEqual(["new", "old"]);
    expect(devices[1]?.userAgent).toBe("UA one");
  });
});
