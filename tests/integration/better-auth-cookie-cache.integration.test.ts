import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";

import type { AppEnv } from "~/lib/env.server";

import { appEnv, uid } from "./fixtures";
import { env } from "cloudflare:workers";

/**
 * Issue #2979 — Better Auth session reads hit the single-region D1 leader on
 * EVERY authenticated request because getBetterAuthSession() passed
 * disableCookieCache:true. This suite proves the cookie-cache fix end to end
 * on real workerd + real D1 (the repo's real migrations — no mocked binding):
 *
 * 1. A real sign-in (magic-link flow, same helper chain production uses)
 *    mints BOTH the signed session_token cookie AND the signed session_data
 *    cache cookie, so the cache reaches the browser.
 * 2. With the session_data cookie present, a session lookup performs ZERO
 *    D1 reads; without it, exactly the old D1 read happens (the "before").
 * 3. A plan change (user_plan row) is honored on the very next request even
 *    while the session itself is served from the untouched 45s cache —
 *    because the cached session payload carries no plan data.
 * 4. After the cache TTL lapses (system clock advanced), the lookup falls
 *    back to the D1 read and reflects revocation (sign-out deletes the DB
 *    session; the cached copy answers only until its TTL expires).
 *
 * The D1 read counts below ARE the dashboard-TTFB mechanism: the leader read
 * (session JOIN user) disappears from the hot path for 45s at a time.
 */

const TEST_SECRET = "0509-cookie-cache-integration-secret-0509";
const TEST_BASE_URL = "http://0509.test";

interface CapturedEmail {
  from: string | { email: string; name?: string };
  html?: string;
  subject: string;
  text?: string;
  to: string | { email: string } | (string | { email: string })[];
}

function countingDb(db: D1Database) {
  let count = 0;
  const counted = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (query: string) => {
          count += 1;
          return target.prepare(query);
        };
      }
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) => {
          count += statements.length;
          return target.batch(statements);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return {
    db: counted as D1Database,
    reads: () => count,
    reset: () => {
      count = 0;
    },
  };
}

function testEnv(db: D1Database, sent: CapturedEmail[]): AppEnv {
  return {
    ...appEnv,
    APP_ORIGIN: TEST_BASE_URL,
    AUTH_PROVIDER: "better-auth",
    BETTER_AUTH_SECRET: TEST_SECRET,
    BETTER_AUTH_URL: TEST_BASE_URL,
    DB: db,
    EMAIL: {
      send: (message) => {
        sent.push(message);
        return Promise.resolve({ messageId: "test-0509" });
      },
    },
    EMAIL_FROM_EMAIL: "no-reply@0509.test",
  };
}

function authedRequest(url: string, cookies: string[]): Request {
  return new Request(url, {
    headers: {
      cookie: cookies.join("; "),
      origin: TEST_BASE_URL,
    },
  });
}

function firstVisitRequest(url: string): Request {
  return new Request(url, {
    headers: { origin: TEST_BASE_URL },
  });
}

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0] ?? "";
}

function headersSetCookie(headers: Headers): string[] {
  // Same defensive access the production headers helpers use: the Workers
  // types these projects compile against may not carry getSetCookie.
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] })
    .getSetCookie;
  if (getSetCookie) {
    return getSetCookie.call(headers);
  }
  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function setCookieNamed(headers: Headers, name: string): string | undefined {
  return headersSetCookie(headers).find((cookie) => cookie.startsWith(`${name}=`));
}

async function insertUserPlanRow(userId: string) {
  await env.DB.prepare(
    `INSERT INTO user_plan (user_id, plan) VALUES (?, 'free')`,
  )
    .bind(userId)
    .run();
}

describe("Better Auth cookie cache (issue #2979)", () => {
  let sent: CapturedEmail[];
  let counted: ReturnType<typeof countingDb>;
  let testAppEnv: AppEnv;
  let userId: string;
  let email: string;

  const signInWithRealMagicLink = async (): Promise<Record<string, string>> => {
    const { sendBetterAuthMagicLink } = await import("~/lib/better-auth.server");
    const bootstrapRequest = authedRequest(`${TEST_BASE_URL}/auth/login`, []);
    await sendBetterAuthMagicLink(testAppEnv, bootstrapRequest, {
      email,
      mode: "login",
      redirectTo: "/app/watchlists",
    });

    // The hook stored a confirmation ticket; the email carries its id.
    expect(sent.length).toBe(1);
    const ticketMatch = `${sent[0]?.html ?? ""}${sent[0]?.text ?? ""}`.match(
      /ticket=([A-Za-z0-9_.-]+)/,
    );
    expect(ticketMatch).toBeTruthy();
    const ticketId = ticketMatch![1] ?? "";

    // Exchange the emailed ticket for the confirmation cookie, exactly as the
    // /auth/better/magic-link loader does.
    const {
      betterAuthMagicLinkConfirmationTicketCookie,
      readBetterAuthMagicLinkVerificationTicket,
      verifyBetterAuthMagicLink,
    } = await import("~/lib/better-auth.server");
    const confirmationTicket = await betterAuthMagicLinkConfirmationTicketCookie(
      testAppEnv,
      bootstrapRequest,
      { ticketId },
    );
    const confirmRequest = authedRequest(`${TEST_BASE_URL}/app`, [
      cookiePair(confirmationTicket.cookie),
    ]);
    const confirmation = await readBetterAuthMagicLinkVerificationTicket(
      testAppEnv,
      confirmRequest,
    );
    expect(confirmation).not.toBeNull();

    // Real Better Auth verification: creates the session and — with the
    // cookie cache enabled — mints the session_data cache cookie.
    const response = await verifyBetterAuthMagicLink(
      testAppEnv,
      confirmRequest,
      confirmation!,
    );
    const sessionToken = setCookieNamed(
      response.headers,
      "better-auth.session_token",
    );
    const sessionData = setCookieNamed(response.headers, "better-auth.session_data");
    expect(sessionToken).toBeTruthy();
    expect(sessionData).toBeTruthy();
    return {
      "better-auth.session_token": cookiePair(sessionToken!),
      "better-auth.session_data": cookiePair(sessionData!),
    };
  };

  beforeEach(async () => {
    vi.resetModules();
    sent = [];
    counted = countingDb(env.DB);
    testAppEnv = testEnv(counted.db, sent);
    userId = uid("bacc");
    email = `${userId}@0509.test`;
    await env.DB.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
      .bind(userId, `Fixture ${userId}`, email, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
      .run();
    await insertUserPlanRow(userId);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("serves the session from the signed cookie with zero D1 reads, and a plan change lands within one request", async () => {
    const cookies = await signInWithRealMagicLink();

    // CACHED PATH: the 45s signed cookie answers the session lookup with
    // ZERO D1 reads — this is the dashboard-TTFB mechanism.
    counted.reset();
    const { getBetterAuthSession } = await import("~/lib/better-auth.server");
    const sessionRequest = authedRequest(`${TEST_BASE_URL}/app`, Object.values(cookies));
    const cached = await getBetterAuthSession(testAppEnv, sessionRequest);
    expect(cached).not.toBeNull();
    expect(cached?.user.id).toBe(userId);
    expect(cached?.user.email).toBe(email);
    expect(counted.reads()).toBe(0);

    // PLAN CHANGE: the plan lives in user_plan, NOT in the cached session
    // payload, so flipping it while the session rides the untouched 45s
    // cache must be honored within this very request.
    const { getUserPlan } = await import("~/lib/plan.server");
    counted.reset();
    await env.DB.prepare(`UPDATE user_plan SET plan = 'scout' WHERE user_id = ?`)
      .bind(userId)
      .run();
    const planChangedSession = await getBetterAuthSession(testAppEnv, sessionRequest);
    expect(counted.reads()).toBe(0); // still the cached session...
    expect(planChangedSession?.user.id).toBe(userId);
    expect(await getUserPlan(testAppEnv, userId)).toBe("scout"); // ...with the NEW plan.

    // THE "BEFORE": the old shape — token only, no session_data cookie —
    // goes to D1 on every request. One authenticated request, one+ leader
    // read. (Sequential, not parallel: never two test suites at once.)
    counted.reset();
    const uncachedRequest = authedRequest(`${TEST_BASE_URL}/app`, [
      cookies["better-auth.session_token"]!,
    ]);
    const uncached = await getBetterAuthSession(testAppEnv, uncachedRequest);
    expect(uncached?.user.id).toBe(userId);
    expect(counted.reads()).toBeGreaterThan(0);

    // PARITY: both paths agree on the identity — the cached copy is the same
    // session, not a stale or corrupted one.
    expect(uncached?.session.userId).toBe(cached?.session.userId);
    expect(uncached?.user.email).toBe(cached?.user.email);
  });

  it("expires with its TTL and reflects a sign-out from D1", async () => {
    const cookies = await signInWithRealMagicLink();
    const sessionRequest = authedRequest(`${TEST_BASE_URL}/app`, Object.values(cookies));
    const { getBetterAuthSession, signOutBetterAuth } = await import(
      "~/lib/better-auth.server"
    );

    // Sign-out: better-auth's sign-out response expires BOTH the session
    // token and the session_data cache cookie (explicit invalidation), and
    // the DB session row is deleted.
    const signOutResponse = await signOutBetterAuth(testAppEnv, sessionRequest);
    const cleared = headersSetCookie(signOutResponse.headers).join(" | ");
    expect(cleared).toContain("better-auth.session_token=");
    expect(cleared).toContain("better-auth.session_data=");

    // The signed cookie cache answers while it is fresh — that is the whole
    // point — so a revoked-but-cached session stays valid until its TTL.
    counted.reset();
    expect(await getBetterAuthSession(testAppEnv, sessionRequest)).not.toBeNull();
    expect(counted.reads()).toBe(0);

    // Advance past the 45s TTL: the payload's own expiresAt lapses, the
    // lookup must return to D1 — where the session row no longer exists.
    const afterTtl = Date.now() + 60_000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(afterTtl));
    counted.reset();
    const afterSignOut = await getBetterAuthSession(testAppEnv, sessionRequest);
    expect(afterSignOut).toBeNull();
    expect(counted.reads()).toBeGreaterThan(0);
  });
});
