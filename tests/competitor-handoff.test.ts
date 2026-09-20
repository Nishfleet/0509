import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  signCompetitorHandoff,
  verifyCompetitorHandoff,
} from "~/lib/competitor-handoff.server";
import type { AppEnv } from "~/lib/env.server";

/**
 * Issue #2174 — the signed, short-lived competitor handoff token.
 *
 * The token carries the searched domain + the candidates a logged-out
 * visitor picked on /search, and must survive the email-link round-trip into
 * onboarding. The wire format is an HS256 compact JWT (jose) whose `exp`
 * claim carries the 30-minute expiry. This suite pins the three properties
 * that make it safe:
 *
 *   1. Round-trip: a signed token verifies back to the exact payload.
 *   2. Tamper-proof: any change to the payload (or a forged signature)
 *      fails verification with a named code — never a silent accept.
 *   3. Short-lived: an expired token fails with `expired`.
 *
 * The token is keyed by `BETTER_AUTH_SECRET` (always present in the app and
 * in tests — no new secret, no new env var).
 */

const SECRET = "test-secret-that-is-more-than-32-characters-long";

function env(overrides: Record<string, unknown> = {}): AppEnv {
  return { BETTER_AUTH_SECRET: SECRET, ...overrides } as AppEnv;
}

const PAYLOAD = {
  domain: "nykaa.com",
  country: "United States",
  candidates: [
    {
      advertiser: "Rothy's",
      pageId: "page-1",
      landingPageUrl: "https://rothys.com",
      targetCountry: "United States",
    },
    {
      advertiser: "Vivaia",
      pageId: null,
      landingPageUrl: "https://vivaia.com",
      targetCountry: null,
    },
  ],
};

describe("competitor handoff token (issue #2174)", () => {
  it("round-trips a signed token back to the exact payload", async () => {
    const token = await signCompetitorHandoff(env(), PAYLOAD);
    expect(token).toBeTruthy();

    const result = await verifyCompetitorHandoff(env(), token!);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.payload).toEqual(PAYLOAD);
  });

  it("rejects a tampered payload with a named code", async () => {
    const token = await signCompetitorHandoff(env(), PAYLOAD);
    expect(token).toBeTruthy();

    // Flip a character in the payload segment — the JWS signature covers the
    // encoded segments, so any change must fail signature verification.
    const [header, payloadB64, signature] = token!.split(".");
    const tamperedPayload = payloadB64!.slice(0, -1) + (payloadB64!.endsWith("A") ? "B" : "A");
    const tampered = `${header}.${tamperedPayload}.${signature}`;

    const result = await verifyCompetitorHandoff(env(), tampered);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("invalid");
  });

  it("rejects a forged signature (wrong secret) with a named code", async () => {
    const token = await signCompetitorHandoff(env(), PAYLOAD);
    expect(token).toBeTruthy();

    // Verify with a different secret — the signature must not match.
    const result = await verifyCompetitorHandoff(
      env({ BETTER_AUTH_SECRET: "a-completely-different-secret-value-here" }),
      token!,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("invalid");
  });

  it("rejects a malformed token with a named code", async () => {
    const result = await verifyCompetitorHandoff(env(), "not-a-token");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("malformed");
  });

  it("rejects an expired token with a named code", async () => {
    const token = await signCompetitorHandoff(env(), PAYLOAD);
    expect(token).toBeTruthy();

    // A freshly signed token must verify (not expired).
    const fresh = await verifyCompetitorHandoff(env(), token!);
    expect(fresh.ok).toBe(true);

    // Mint an already-expired HS256 JWT with the same claims shape and the
    // same secret — the library enforces `exp`, so verify must say expired.
    const expired = await new SignJWT({
      d: PAYLOAD.domain,
      ctry: PAYLOAD.country,
      cand: PAYLOAD.candidates.map((candidate) => ({
        a: candidate.advertiser,
        p: candidate.pageId,
        l: candidate.landingPageUrl,
        t: candidate.targetCountry,
      })),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(SECRET));

    const result = await verifyCompetitorHandoff(env(), expired);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("expired");

    // The fresh token's `exp` claim is the registered JWT claim in seconds.
    const payloadB64 = token!.split(".")[1]!;
    const wire = JSON.parse(
      Buffer.from(payloadB64.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8"),
    ) as { exp: number };
    expect(wire.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("returns null when no signing secret is configured (degrade path)", async () => {
    const token = await signCompetitorHandoff(env({ BETTER_AUTH_SECRET: "" }), PAYLOAD);
    expect(token).toBeNull();

    const result = await verifyCompetitorHandoff(env({ BETTER_AUTH_SECRET: "" }), "x.y");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("secret_missing");
  });
});
