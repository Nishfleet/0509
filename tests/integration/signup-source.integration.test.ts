import { describe, expect, it } from "vitest";

import {
  applySignupSourceToNewUser,
  readUserSignupSource,
  rememberAllowlistedSignupSource,
  signupSourceFromRequest,
} from "~/lib/signup-source";

import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

/**
 * Fixtures where the code rule and the 0087 CHECK constraint must agree
 * (issue #2108 step 2c). Mirrors the list in tests/signup-source.test.ts —
 * keep the two in sync.
 */
const ACCEPTED_BY_BOTH = [
  "ref:example.com",
  "pricing-free",
  "for_agencies",
  "digest_footer",
  "locale-de-sneaker-resale",
  "summer-2026-launch",
  "search_warming_exhausted",
  "guide_track_ads",
  "a",
];
const REJECTED_BY_BOTH = [
  "My Campaign",
  "a?b",
  "ref:EXAMPLE.com",
  "https://example.com/page",
  "ref:example.com?x=1",
  "<script>",
  "",
  "x".repeat(45),
];

/**
 * Expand-phase signup_source (issue 1200): the column must exist on real D1
 * after the repo migrations, accept only the allowlisted markers, and round-trip
 * through the signup WRITE path (pending row → user row) and the later READ.
 */
describe("signup_source against real D1", () => {
  it("leaves existing users NULL and reads that NULL back", async () => {
    const userId = await seedUser();
    const row = await db()
      .prepare("SELECT signup_source FROM user WHERE id = ?")
      .bind(userId)
      .first<{ signup_source: string | null }>();
    expect(row).toBeDefined();
    expect(row?.signup_source).toBeNull();
    expect(await readUserSignupSource(appEnv, userId)).toBeNull();
  });

  it("writes two locale markers through remember+apply and reads them back", async () => {
    const magicUser = await seedUser(uid("src_mb"));
    const localeUser = await seedUser(uid("src_de"));
    const magicEmail = `${magicUser}@example.test`;
    const localeEmail = `${localeUser}@example.test`;
    await db()
      .prepare("UPDATE user SET email = ? WHERE id = ?")
      .bind(magicEmail, magicUser)
      .run();
    await db()
      .prepare("UPDATE user SET email = ? WHERE id = ?")
      .bind(localeEmail, localeUser)
      .run();

    expect(
      await rememberAllowlistedSignupSource(appEnv, {
        email: magicEmail,
        source: "locale-ja-sneaker-resale",
      }),
    ).toBe("locale-ja-sneaker-resale");
    expect(
      await rememberAllowlistedSignupSource(appEnv, {
        email: localeEmail,
        source: "locale-de-sneaker-resale",
      }),
    ).toBe("locale-de-sneaker-resale");

    expect(
      await applySignupSourceToNewUser(appEnv, { user: { id: magicUser, email: magicEmail } }),
    ).toBe("locale-ja-sneaker-resale");
    expect(
      await applySignupSourceToNewUser(appEnv, { user: { id: localeUser, email: localeEmail } }),
    ).toBe("locale-de-sneaker-resale");

    expect(await readUserSignupSource(appEnv, magicUser)).toBe("locale-ja-sneaker-resale");
    expect(await readUserSignupSource(appEnv, localeUser)).toBe("locale-de-sneaker-resale");

    const pending = await db()
      .prepare("SELECT email FROM signup_source_pending WHERE email IN (?, ?)")
      .bind(magicEmail, localeEmail)
      .all<{ email: string }>();
    expect(pending.results ?? []).toEqual([]);
  });

  it("does not store the raw query string, and CHECK rejects unknown values", async () => {
    const userId = await seedUser(uid("src_bad"));
    const email = `${userId}@example.test`;
    await db().prepare("UPDATE user SET email = ? WHERE id = ?").bind(email, userId).run();

    expect(
      await rememberAllowlistedSignupSource(appEnv, {
        email,
        source: "locale-ja-sneaker-resale&x=<script>alert(1)</script>",
      }),
    ).toBeNull();
    expect(await applySignupSourceToNewUser(appEnv, { user: { id: userId, email } })).toBeNull();
    expect(await readUserSignupSource(appEnv, userId)).toBeNull();

    const hostileId = uid("src_chk");
    await expect(
      db()
        .prepare(
          `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, signup_source)
           VALUES (?, ?, ?, 1, ?, ?, ?)`,
        )
        .bind(hostileId, "Hostile", `${hostileId}@example.test`, ISO_T0, ISO_T0, "<script>")
        .run(),
    ).rejects.toThrow();
  });

  it("keeps the first write: a later apply does not overwrite signup_source", async () => {
    const userId = await seedUser(uid("src_once"));
    const email = `${userId}@example.test`;
    await db().prepare("UPDATE user SET email = ? WHERE id = ?").bind(email, userId).run();

    await rememberAllowlistedSignupSource(appEnv, {
      email,
      source: "locale-en-sneaker-resale",
    });
    await applySignupSourceToNewUser(appEnv, { user: { id: userId, email } });

    await rememberAllowlistedSignupSource(appEnv, {
      email,
      source: "locale-ja-sneaker-resale",
    });
    await applySignupSourceToNewUser(appEnv, { user: { id: userId, email } });

    expect(await readUserSignupSource(appEnv, userId)).toBe("locale-en-sneaker-resale");
  });

  it("persists a referer-derived ref:<eTLD+1> marker end to end (issue #2108 accept)", async () => {
    const userId = await seedUser(uid("src_ref"));
    const email = `${userId}@example.test`;
    await db().prepare("UPDATE user SET email = ? WHERE id = ?").bind(email, userId).run();

    // A signup arriving with only `Referer: https://example.com/page`.
    const request = new Request("https://0509.io/auth/signup", {
      headers: { referer: "https://example.com/page" },
    });
    const derived = signupSourceFromRequest(request);
    expect(derived).toBe("ref:example.com");

    expect(await rememberAllowlistedSignupSource(appEnv, { email, source: derived })).toBe(
      "ref:example.com",
    );
    expect(await applySignupSourceToNewUser(appEnv, { user: { id: userId, email } })).toBe(
      "ref:example.com",
    );
    expect(await readUserSignupSource(appEnv, userId)).toBe("ref:example.com");

    const row = await db()
      .prepare("SELECT signup_source FROM user WHERE id = ?")
      .bind(userId)
      .first<{ signup_source: string | null }>();
    expect(row?.signup_source).toBe("ref:example.com");
  });

  it("persists an open slug through remember+apply and reads it back", async () => {
    const userId = await seedUser(uid("src_slug"));
    const email = `${userId}@example.test`;
    await db().prepare("UPDATE user SET email = ? WHERE id = ?").bind(email, userId).run();

    expect(
      await rememberAllowlistedSignupSource(appEnv, { email, source: "summer-2026-launch" }),
    ).toBe("summer-2026-launch");
    expect(await applySignupSourceToNewUser(appEnv, { user: { id: userId, email } })).toBe(
      "summer-2026-launch",
    );
    expect(await readUserSignupSource(appEnv, userId)).toBe("summer-2026-launch");
  });

  it("0087 CHECK constraints accept and reject the same fixture list as the code rule", async () => {
    for (const fixture of ACCEPTED_BY_BOTH) {
      const userId = uid("src_ok");
      await db()
        .prepare(
          `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, signup_source)
           VALUES (?, ?, ?, 1, ?, ?, ?)`,
        )
        .bind(userId, "Fixture", `${userId}@example.test`, ISO_T0, ISO_T0, fixture)
        .run();
      const pendingEmail = `${uid("src_ok")}@example.test`;
      await db()
        .prepare(
          `INSERT INTO signup_source_pending (email, signup_source, created_at, expires_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(pendingEmail, fixture, ISO_T0, "2026-01-02T00:00:00.000Z")
        .run();
    }

    for (const fixture of REJECTED_BY_BOTH) {
      const userId = uid("src_no");
      await expect(
        db()
          .prepare(
            `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, signup_source)
             VALUES (?, ?, ?, 1, ?, ?, ?)`,
          )
          .bind(userId, "Fixture", `${userId}@example.test`, ISO_T0, ISO_T0, fixture)
          .run(),
      ).rejects.toThrow();
      await expect(
        db()
          .prepare(
            `INSERT INTO signup_source_pending (email, signup_source, created_at, expires_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(`${uid("src_no")}@example.test`, fixture, ISO_T0, "2026-01-02T00:00:00.000Z")
          .run(),
      ).rejects.toThrow();
    }
  });

  it("rebuilt user table keeps its email index and inbound foreign keys", async () => {
    const index = await db()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_user_email_nocase'",
      )
      .first<{ name: string }>();
    expect(index?.name).toBe("idx_user_email_nocase");

    // The rebuild creates user_new, copies, drops user, then renames
    // user_new into place — child tables must still reference `user`, never
    // a dropped rename target.
    const sessionTable = await db()
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'session'")
      .first<{ sql: string }>();
    expect(sessionTable?.sql).toContain("REFERENCES user(id)");
    expect(sessionTable?.sql).not.toContain("user_old");

    const userId = await seedUser(uid("src_fk"));
    await db()
      .prepare(
        `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(uid("sess"), "2026-01-02T00:00:00.000Z", uid("tok"), ISO_T0, ISO_T0, userId)
      .run();
    const session = await db()
      .prepare("SELECT userId FROM session WHERE userId = ?")
      .bind(userId)
      .first<{ userId: string }>();
    expect(session?.userId).toBe(userId);
  });
});
