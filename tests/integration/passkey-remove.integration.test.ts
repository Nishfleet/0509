import { env } from "cloudflare:test";
import { serializeSignedCookie } from "better-call";
import { beforeEach, describe, expect, it } from "vitest";

import { createAuth, removeSignedInPasskey } from "../../app/lib/auth.server";
import { runSettingsIntent } from "../../app/lib/settings.server";

const USER = "user-passkey-remove";
const PASSKEY = "pk-remove-1";
const SECRET = "passkey-remove-test-secret-0123456789abcdef";
const DAY_MS = 24 * 60 * 60 * 1000;
const authEnv = { ...env, BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: "https://0509.io" };

const call = (fields: Record<string, string>) =>
  runSettingsIntent(
    { id: USER, email: "owner@0509.io" },
    new Request("https://0509.io/app/settings", { method: "POST", body: new URLSearchParams(fields) }),
    {} as never,
  );

async function signedInRequest(ageMs: number): Promise<Request> {
  const context = await createAuth(authEnv).$context;
  const session = await context.internalAdapter.createSession(USER);
  const createdAt = new Date(Date.now() - ageMs).toISOString();
  await env.DB.prepare(`UPDATE session SET createdAt = ? WHERE token = ?`).bind(createdAt, session.token).run();
  const cookie =
    (await serializeSignedCookie("__Secure-better-auth.session_token", session.token, SECRET)).split(";")[0] ?? "";
  return new Request("https://0509.io/app/settings", { headers: { cookie } });
}

const passkeyRows = async () =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM passkey WHERE id = ?`).bind(PASSKEY).first<{ n: number }>())?.n;

describe("passkey-remove", () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (?, 'Owner', 'owner@0509.io', 1, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      ).bind(USER),
      env.DB.prepare(
        `INSERT INTO passkey (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, createdAt)
         VALUES (?, 'Laptop', 'pk', ?, 'cred-1', 0, 'singleDevice', 0, '2026-10-01T00:00:00Z')`,
      ).bind(PASSKEY, USER),
    ]);
  });

  it("answers the sign-in-again message when the request carries no session", async () => {
    const result = await call({ intent: "passkey-remove", passkeyId: PASSKEY });
    expect(result.passkeyError).toBe("For your safety, sign out and sign back in, then remove your passkey.");
  });

  it("refuses a missing passkey id without touching auth", async () => {
    const result = await call({ intent: "passkey-remove" });
    expect(result.passkeyError).toBe("The passkey wasn't removed. Try again.");
  });

  it("refuses a session older than a day and keeps the passkey", async () => {
    const request = await signedInRequest(DAY_MS + 60_000);
    expect(await removeSignedInPasskey(authEnv, request, PASSKEY)).toBe("stale");
    expect(await passkeyRows()).toBe(1);
  });

  it("removes the passkey for a fresh session", async () => {
    const request = await signedInRequest(60_000);
    expect(await removeSignedInPasskey(authEnv, request, PASSKEY)).toBe("removed");
    expect(await passkeyRows()).toBe(0);
  });
});
