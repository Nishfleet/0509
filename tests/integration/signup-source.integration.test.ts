import { describe, expect, it } from "vitest";

import {
  applySignupSourceToNewUser,
  readUserSignupSource,
  rememberAllowlistedSignupSource,
} from "~/lib/signup-source";

import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

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

  it("writes MagicBrief and locale markers through remember+apply and reads them back", async () => {
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
        source: "magicbrief-migration",
      }),
    ).toBe("magicbrief-migration");
    expect(
      await rememberAllowlistedSignupSource(appEnv, {
        email: localeEmail,
        source: "locale-de-sneaker-resale",
      }),
    ).toBe("locale-de-sneaker-resale");

    expect(
      await applySignupSourceToNewUser(appEnv, { user: { id: magicUser, email: magicEmail } }),
    ).toBe("magicbrief-migration");
    expect(
      await applySignupSourceToNewUser(appEnv, { user: { id: localeUser, email: localeEmail } }),
    ).toBe("locale-de-sneaker-resale");

    expect(await readUserSignupSource(appEnv, magicUser)).toBe("magicbrief-migration");
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
        source: "magicbrief-migration&x=<script>alert(1)</script>",
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
      source: "magicbrief-migration",
    });
    await applySignupSourceToNewUser(appEnv, { user: { id: userId, email } });

    expect(await readUserSignupSource(appEnv, userId)).toBe("locale-en-sneaker-resale");
  });
});
