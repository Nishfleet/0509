import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import { createAuth } from "../../app/lib/auth.server";
import { FIXTURE_SIGNUPS_PER_DAY } from "../../app/lib/auth/fixture-signup-cap.server";

const AUTH_ENV = {
  DB: env.DB,
  EMAIL: { send: async () => ({ messageId: "test" }) },
  SIGN_IN_EMAIL_LIMIT: env.SIGN_IN_EMAIL_LIMIT,
  SIGN_IN_IP_LIMIT: env.SIGN_IN_IP_LIMIT,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  BETTER_AUTH_SECRET: "integration-test-secret-integration-test-secret",
  BETTER_AUTH_URL: "http://localhost:8787",
} satisfies Parameters<typeof createAuth>[0];

const HOUR_MS = 3_600_000;

async function seedFixtureUsers(count: number, createdAt: string, tag: string): Promise<void> {
  const statements = Array.from({ length: count }, (_, index) =>
    env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)`,
    ).bind(`${tag}-${String(index)}`, `e2e+${tag}${String(index)}@0509.io`, createdAt),
  );
  await env.DB.batch(statements);
}

async function signUp(email: string) {
  const context = await createAuth(AUTH_ENV).$context;
  return context.internalAdapter.createUser({ email, name: email, emailVerified: true }, { method: "magic-link" });
}

async function userExists(email: string): Promise<boolean> {
  return (await env.DB.prepare(`SELECT id FROM "user" WHERE email = ?1`).bind(email).first()) !== null;
}

afterEach(async () => {
  await env.DB.prepare(`DELETE FROM "user" WHERE id LIKE 'cap-%'`).run();
  await env.DB.prepare(
    `DELETE FROM "user" WHERE email IN ('e2e+extra@0509.io','e2e+j7@0509.io','person@example.com')`,
  ).run();
});

describe("per-run fixture sign-up cap", () => {
  it("refuses the next fixture user once the cap is reached in the last 24 hours", async () => {
    await seedFixtureUsers(FIXTURE_SIGNUPS_PER_DAY, new Date(Date.now() - HOUR_MS).toISOString(), "cap-recent");

    await expect(signUp("e2e+extra@0509.io")).rejects.toMatchObject({ statusCode: 429 });
    expect(await userExists("e2e+extra@0509.io")).toBe(false);
  });

  it("admits the last user under the cap", async () => {
    await seedFixtureUsers(FIXTURE_SIGNUPS_PER_DAY - 1, new Date(Date.now() - HOUR_MS).toISOString(), "cap-recent");

    await signUp("e2e+extra@0509.io");
    expect(await userExists("e2e+extra@0509.io")).toBe(true);
  });

  it("does not count fixture users older than 24 hours", async () => {
    await seedFixtureUsers(FIXTURE_SIGNUPS_PER_DAY, new Date(Date.now() - 25 * HOUR_MS).toISOString(), "cap-old");

    await signUp("e2e+extra@0509.io");
    expect(await userExists("e2e+extra@0509.io")).toBe(true);
  });

  it("still signs a normal email up at the cap", async () => {
    await seedFixtureUsers(FIXTURE_SIGNUPS_PER_DAY, new Date(Date.now() - HOUR_MS).toISOString(), "cap-recent");

    await signUp("person@example.com");
    expect(await userExists("person@example.com")).toBe(true);
  });

  it("never refuses a kept account at the cap", async () => {
    await seedFixtureUsers(FIXTURE_SIGNUPS_PER_DAY, new Date(Date.now() - HOUR_MS).toISOString(), "cap-recent");

    await signUp("e2e+j7@0509.io");
    expect(await userExists("e2e+j7@0509.io")).toBe(true);
  });

  it("does not count kept accounts toward the cap", async () => {
    await seedFixtureUsers(FIXTURE_SIGNUPS_PER_DAY - 1, new Date(Date.now() - HOUR_MS).toISOString(), "cap-recent");
    await signUp("e2e+j7@0509.io");

    await signUp("e2e+extra@0509.io");
    expect(await userExists("e2e+extra@0509.io")).toBe(true);
  });
});
