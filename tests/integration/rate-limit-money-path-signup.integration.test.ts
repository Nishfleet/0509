import { describe, expect, it } from "vitest";

import { enforceRequestRateLimit } from "~/lib/rate-limit.server";

import { appEnv } from "./fixtures";

/**
 * Issue #3317 — the anonymous money-path: /auth/signup (the converting step
 * of the four-step anonymous funnel) plus the passive /api/auth/get-session
 * prefetches fired by EVERY funnel page (search -> result -> pricing ->
 * signup-start) now share a generous anonymous-GET budget (RL_AUTH_GET,
 * 60/60s per IP) instead of the tight credential-POST bucket (RL_AUTH,
 * 2/60s, the #2964 20/10min legacy) that 429'd the 2026-09-12 money-path
 * walk (25 × curl /auth/signup -> 7×200 / 18×429, signup page effectively
 * blank). State-changing /api/auth calls keep that tight fail-closed
 * ceiling, and when the GET budget does 429 the body stays honest.
 *
 * This runs the REAL limiter (`enforceRequestRateLimit`) against the REAL
 * RL_AUTH_GET / RL_AUTH edge bindings declared in tests/integration/
 * wrangler.test.jsonc (mirroring production) — no mocked binding, matching
 * the rate-limit-verified-bot integration precedent.
 *
 * Each it() uses its OWN key IP so the real binding's 60s-window counters
 * (which persist for the lifetime of the test file's isolate) cannot couple
 * the legs: every leg then proves its own budget exactly.
 */
describe("money-path signup anonymous-GET budget (issue #3317)", () => {
  function getRequest(path: string, ip: string, ua = "money-path-integration") {
    return new Request(`https://0509.io${path}`, {
      headers: { "cf-connecting-ip": ip, "user-agent": ua },
    });
  }

  it("keeps the funnel's page reads and passive session prefetches off the credential-POST ceiling", async () => {
    // Both devices walking search -> result -> pricing -> signup-start:
    // four prefetches per device (one per page) plus the signup page read
    // itself. On the pre-#3317 single 2/60s bucket the third funnel page
    // already 429'd; every one of these must pass now.
    for (let step = 0; step < 4; step += 1) {
      await expect(
        enforceRequestRateLimit(getRequest("/api/auth/get-session", "203.0.113.90", "desktop"), appEnv),
      ).resolves.toBeNull();
      await expect(
        enforceRequestRateLimit(getRequest("/api/auth/get-session", "203.0.113.90", "mobile"), appEnv),
      ).resolves.toBeNull();
    }
    await expect(
      enforceRequestRateLimit(getRequest("/auth/signup", "203.0.113.90", "desktop"), appEnv),
    ).resolves.toBeNull();
    await expect(
      enforceRequestRateLimit(getRequest("/auth/signup", "203.0.113.90", "mobile"), appEnv),
    ).resolves.toBeNull();
  });

  it("passes a 24-GET/10-min signup burst at ≤1 rps with zero 429s", async () => {
    // These calls run strictly faster than 1 rps, so they all land inside
    // one 60s window — the strictest case for the 60/60s budget (a paced
    // ≤1 rps burst can only straddle more windows, never fewer). Real
    // binding, real counting: 24 GETs, zero 429s.
    for (let index = 0; index < 24; index += 1) {
      const response = await enforceRequestRateLimit(
        getRequest("/auth/signup", "203.0.113.91", "burst"),
        appEnv,
      );
      expect(response, `signup burst request ${index} must not 429`).toBeNull();
    }
  });

  it("keeps state-changing auth calls on the tight 2/60s fail-closed ceiling", async () => {
    // The GET burst above did NOT spend this bucket: the scopes are split
    // (auth-anon-get on RL_AUTH_GET vs auth on RL_AUTH), so the sign-up
    // credential POST keeps its tight #2964-legacy ceiling and 429s (JSON
    // envelope, Retry-After preserved) exactly like before this issue.
    const post = () =>
      new Request("https://0509.io/api/auth/sign-up/email", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.92", "user-agent": "money-path-integration" },
      });
    await expect(enforceRequestRateLimit(post(), appEnv)).resolves.toBeNull();
    await expect(enforceRequestRateLimit(post(), appEnv)).resolves.toBeNull();
    const blocked = await enforceRequestRateLimit(post(), appEnv);
    expect(blocked, "the third credential POST must stay on the 2/60s ceiling").not.toBeNull();
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("retry-after")).toBe("60");
    await expect(blocked?.json()).resolves.toMatchObject({ error: "rate_limited" });
  });

  it("renders the honest readable 429 document when the anonymous-GET budget does exhaust", async () => {
    // Issue #3317 acceptance 4: when the generous budget DOES 429 (a
    // shared-NAT flood), the body stays honest — readable copy, never a
    // bare status or raw JSON — and Retry-After is preserved.
    let blocked: Response | null = null;
    const overshootCap = 80;
    for (let index = 0; index < overshootCap && !blocked; index += 1) {
      blocked = await enforceRequestRateLimit(getRequest("/auth/signup", "203.0.113.93", "flood"), appEnv);
    }
    expect(blocked, `expected a 429 within ${overshootCap} over-budget requests`).not.toBeNull();
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("retry-after")).toBe("60");
    expect(blocked?.headers.get("content-type")).toContain("text/html");
    const body = await blocked!.text();
    expect(body).toContain("Checking faster than we allow");
    expect(body).toContain("Try again");
    // NOT a bare status or the API JSON envelope.
    expect(body).not.toContain("rate_limited");
  });
});
