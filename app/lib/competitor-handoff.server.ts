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
 * The token is a `base64url(payload).hex-signature` string:
 *
 *   - payload is a compact JSON object `{ d, c, ctry, exp }` (short keys so
 *     the token stays small enough for a query param and a magic-link URL).
 *   - signature is an HMAC-SHA256 over the payload bytes, keyed by
 *     `BETTER_AUTH_SECRET` (always present in the app and in tests — no new
 *     secret, no new env var).
 *
 * The token is single-purpose and short-lived (default 30 minutes, matching
 * the magic-link window). It is NOT a session and carries no credentials —
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

interface HandoffWire {
  d: string;
  ctry: string;
  cand: Array<{
    a: string;
    p: string | null;
    l: string | null;
    t: string | null;
  }>;
  exp: number;
}

function handoffSecret(env: AppEnv): string {
  return env.BETTER_AUTH_SECRET?.trim() ?? "";
}

async function importHandoffKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array<ArrayBuffer> {
  const pairs = value.match(/.{2}/g) ?? [];
  return new Uint8Array(pairs.map((pair) => Number.parseInt(pair, 16)));
}

function toWire(payload: CompetitorHandoffPayload, now: number): HandoffWire {
  return {
    d: payload.domain,
    ctry: payload.country,
    cand: payload.candidates.map((candidate) => ({
      a: candidate.advertiser,
      p: candidate.pageId,
      l: candidate.landingPageUrl,
      t: candidate.targetCountry,
    })),
    exp: now + HANDOFF_TTL_MS,
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
  const secret = handoffSecret(env);
  if (!secret) {
    return null;
  }
  const wire = toWire(payload, Date.now());
  const payloadBytes = encoder.encode(JSON.stringify(wire));
  const key = await importHandoffKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, payloadBytes);
  return `${toBase64Url(payloadBytes)}.${toHex(new Uint8Array(signature))}`;
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
  const secret = handoffSecret(env);
  if (!secret) {
    return { ok: false, code: "secret_missing" };
  }

  const separator = token.lastIndexOf(".");
  if (separator <= 0) {
    return { ok: false, code: "malformed" };
  }
  const payloadB64 = token.slice(0, separator);
  const signatureHex = token.slice(separator + 1).trim().toLowerCase();
  if (!payloadB64 || !/^[0-9a-f]{64}$/.test(signatureHex)) {
    return { ok: false, code: "malformed" };
  }

  let payloadBytes: Uint8Array<ArrayBuffer>;
  try {
    payloadBytes = fromBase64Url(payloadB64);
  } catch {
    return { ok: false, code: "malformed" };
  }

  const key = await importHandoffKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    fromHex(signatureHex),
    payloadBytes,
  );
  if (!valid) {
    return { ok: false, code: "invalid" };
  }

  let wire: HandoffWire;
  try {
    wire = JSON.parse(new TextDecoder().decode(payloadBytes)) as HandoffWire;
  } catch {
    return { ok: false, code: "malformed" };
  }
  if (
    typeof wire.d !== "string" ||
    typeof wire.ctry !== "string" ||
    !Array.isArray(wire.cand) ||
    typeof wire.exp !== "number"
  ) {
    return { ok: false, code: "malformed" };
  }
  if (wire.exp <= Date.now()) {
    return { ok: false, code: "expired" };
  }

  return { ok: true, payload: fromWire(wire) };
}
