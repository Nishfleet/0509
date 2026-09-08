import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

/**
 * Issue #1872 — OAuth signup completion emits `signup_completed` (BET 7
 * follow-up to #1862).
 *
 * #1862 landed `signup_completed` on the magic-link path only
 * (`completeBetterAuthMagicLinkSignIn`). OAuth signups complete via Better
 * Auth's OAuth callback (`GET /api/auth/callback/:provider`), which never
 * touches the magic-link helper, so they were undercounted by scouts
 * measuring signup -> activation. This test locks in the OAuth seam:
 *
 *  - A brand-new user created via the OAuth callback emits the coarse
 *    workspace-scoped `signup_completed` event (reusing the
 *    `FUNNEL_MEASUREMENT_ENABLED` gate and GPC opt-out).
 *  - The event fires from the `databaseHooks.user.create` hook, which Better
 *    Auth only runs when a genuinely new user row is inserted. A returning
 *    OAuth user already exists, so no `user.create` runs and no
 *    `signup_completed` can be emitted — only new workspaces count. The
 *    magic-link signup path fires the same create hook but from
 *    `/auth/better/magic-link` (not `/api/auth/callback/...`), so the
 *    `isBetterAuthOauthCallbackRequest` gate keeps each signup counted
 *    exactly once (the magic-link event is emitted in
 *    `completeBetterAuthMagicLinkSignIn` instead).
 *
 * The privacy contract is identical to the magic-link event: coarse
 * workspace-scoped count only, no email, name, or user id ever reaches a
 * record.
 */

const FUNNEL_OPERATIONS = ["funnel_signup_completed"];

function emittedFunnelRecords(logSpy: MockInstance): Record<string, unknown>[] {
  return logSpy.mock.calls
    .map((call) => call[0])
    .filter((line): line is string => typeof line === "string")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(
      (record): record is Record<string, unknown> =>
        Boolean(record && typeof record === "object") &&
        FUNNEL_OPERATIONS.includes(String((record as { operation?: unknown }).operation)),
    );
}

function oauthCallbackRequest(provider = "google", base = "http://127.0.0.1:8787") {
  return new Request(`${base}/api/auth/callback/${provider}?code=x&state=y`);
}

let logSpy: MockInstance;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("OAuth callback request detection", () => {
  it("recognizes the Better Auth OAuth callback path for each allowlisted provider", async () => {
    const { isBetterAuthOauthCallbackRequest } = await import("~/lib/better-auth.server");
    expect(isBetterAuthOauthCallbackRequest(oauthCallbackRequest("google"))).toBe(true);
    expect(isBetterAuthOauthCallbackRequest(oauthCallbackRequest("microsoft"))).toBe(true);
  });

  it("rejects non-OAuth-callback requests (magic-link, social start, app routes)", async () => {
    const { isBetterAuthOauthCallbackRequest } = await import("~/lib/better-auth.server");
    // Magic-link signup creates users from this route, never the OAuth
    // callback — so the gate must be false there to avoid double-counting.
    expect(isBetterAuthOauthCallbackRequest(new Request("http://127.0.0.1:8787/auth/better/magic-link"))).toBe(false);
    // The social-sign-in POST that starts the OAuth dance.
    expect(isBetterAuthOauthCallbackRequest(new Request("http://127.0.0.1:8787/api/auth/sign-in/social", { method: "POST" }))).toBe(false);
    // Unknown provider segment is not an OAuth completion.
    expect(isBetterAuthOauthCallbackRequest(new Request("http://127.0.0.1:8787/api/auth/callback/twitter"))).toBe(false);
    // Unrelated app routes never count.
    expect(isBetterAuthOauthCallbackRequest(new Request("http://127.0.0.1:8787/app"))).toBe(false);
  });
});

describe("OAuth new-user signup_completed emission", () => {
  it("emits signup_completed for a new-user OAuth callback when the gate is on", async () => {
    const { emitFunnelSignupCompleted } = await import("~/lib/funnel-measurement.server");
    const callback = oauthCallbackRequest("google");
    emitFunnelSignupCompleted({ FUNNEL_MEASUREMENT_ENABLED: "1" }, callback);
    const [record] = emittedFunnelRecords(logSpy) as [
      { operation: string; details: Record<string, string> },
    ];
    expect(record.operation).toBe("funnel_signup_completed");
    expect(record.details.route).toBe("activation");
    expect(record.details.account_scope).toBe("workspace");
    expect(Object.keys(record.details).sort()).toEqual(
      ["account_scope", "event_id", "route"].sort(),
    );
    // No email, name, user id, or workspace identity ever reaches a record.
    expect(JSON.stringify(record.details)).not.toMatch(/watchlist|competitor|workspace_id|@/i);
    expect(JSON.stringify(record)).not.toMatch(/@/);
  });

  it("suppresses signup_completed when the gate is off", async () => {
    const { emitFunnelSignupCompleted } = await import("~/lib/funnel-measurement.server");
    emitFunnelSignupCompleted({}, oauthCallbackRequest("google"));
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  });

  it("suppresses signup_completed when the OAuth callback carries the GPC opt-out", async () => {
    const { emitFunnelSignupCompleted } = await import("~/lib/funnel-measurement.server");
    const gpc = new Request("http://127.0.0.1:8787/api/auth/callback/google", {
      headers: { "sec-gpc": "1" },
    });
    emitFunnelSignupCompleted({ FUNNEL_MEASUREMENT_ENABLED: "1" }, gpc);
    expect(emittedFunnelRecords(logSpy)).toHaveLength(0);
  });
});
