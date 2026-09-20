import { SignJWT, errors as joseErrors, jwtVerify, type JWTPayload } from "jose";

import type { AppEnv } from "~/lib/env.server";

/**
 * Competitor handoff token (issue #2174 — "DOMAIN IN, COMPETITORS WATCHED").
 *
 * A logged-out visitor on /search can select multiple suggested competitors
 * and start signup. The selected candidates must survive the email-link
 * round-trip (the visitor leaves the browser, opens the setup link, and
 * lands back signed-in) with zero re-entry. A signed, short-lived token
 * carries the searched domain + the chosen candidates through that gap.
 *
 * The token is an HS256 compact JWT (jose):
 *
 *   - claims are a compact JSON object `{ d, ctry, cand, exp }` (short keys
 *     so the token stays small enough for a query param and a magic-link
 *     URL); `exp` is the registered JWT claim, validated by the library.
 *   - signed with `BETTER_AUTH_SECRET` (always present in the app and in
 *     tests — no new secret, no new env var).
 *
 * The token is single-purpose and short-lived (30 minutes, matching the
 * magic-link window). It is NOT a session and carries no credentials —
 * it only names which competitors a visitor picked before they signed up.
 * The onboarding action re-validates every candidate against the plan cap
 * and the existing watchlist-dedupe before creating anything, so a stale or
 * tampered token can never create watchlists outside the plan.
 */

const HANDOFF_TTL_MS = 30 * 60 * 1000;

const encoder = new TextEncoder();

export interface CompetitorHandoffCandidate {
  advertiser: string;
  pageId: string | null;
  landingPageUrl: string | null;
  targetCountry: string | null;
}

export interface CompetitorHandoffPayload {
  domain: string;
  country: string;
  candidates: CompetitorHandoffCandidate[];
}

// `type` (not `interface`) so the implicit index signature satisfies jose's
// `JWTPayload` parameter.
type HandoffWire = {
  d: string;
  ctry: string;
  cand: Array<{
    a: string;
    p: string | null;
    l: string | null;
    t: string | null;
  }>;
};

function handoffKey(env: AppEnv): Uint8Array | null {
  const secret = env.BETTER_AUTH_SECRET?.trim() ?? "";
  return secret ? encoder.encode(secret) : null;
}

function toWire(payload: CompetitorHandoffPayload): HandoffWire {
  return {
    d: payload.domain,
    ctry: payload.country,
    cand: payload.candidates.map((candidate) => ({
      a: candidate.advertiser,
      p: candidate.pageId,
      l: candidate.landingPageUrl,
      t: candidate.targetCountry,
    })),
  };
}

function fromWire(wire: HandoffWire): CompetitorHandoffPayload {
  return {
    domain: wire.d,
    country: wire.ctry,
    candidates: (wire.cand ?? []).map((candidate) => ({
      advertiser: candidate.a,
      pageId: candidate.p,
      landingPageUrl: candidate.l,
      targetCountry: candidate.t,
    })),
  };
}

/**
 * Sign a handoff token. Returns null when no signing secret is configured
 * (the caller degrades to the plain `?website=` prefill path rather than
 * failing the search page).
 */
export async function signCompetitorHandoff(
  env: AppEnv,
  payload: CompetitorHandoffPayload,
): Promise<string | null> {
  const key = handoffKey(env);
  if (!key) {
    return null;
  }
  return new SignJWT(toWire(payload))
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + HANDOFF_TTL_MS) / 1000))
    .sign(key);
}

export type VerifyHandoffResult =
  | { ok: true; payload: CompetitorHandoffPayload }
  | { ok: false; code: "secret_missing" | "malformed" | "expired" | "invalid" };

/**
 * Verify and decode a handoff token. Returns the decoded payload only when
 * the signature matches AND the token has not expired. Any failure returns
 * a named code so the caller can degrade honestly (never silently accept a
 * tampered token).
 */
export async function verifyCompetitorHandoff(
  env: AppEnv,
  token: string,
): Promise<VerifyHandoffResult> {
  const key = handoffKey(env);
  if (!key) {
    return { ok: false, code: "secret_missing" };
  }

  let claims: JWTPayload;
  try {
    ({ payload: claims } = await jwtVerify(token, key));
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      return { ok: false, code: "expired" };
    }
    if (error instanceof joseErrors.JWSSignatureVerificationFailed) {
      return { ok: false, code: "invalid" };
    }
    return { ok: false, code: "malformed" };
  }

  const wire = claims as HandoffWire;
  if (
    typeof wire.d !== "string" ||
    typeof wire.ctry !== "string" ||
    !Array.isArray(wire.cand)
  ) {
    return { ok: false, code: "malformed" };
  }

  return { ok: true, payload: fromWire(wire) };
}
