import { execute, queryOne } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import { PRICING_FREE_SIGNUP_SOURCE } from "~/lib/funnel-measurement.server";
import { registrableDomainFromHostname } from "~/lib/search-query";

/**
 * Durable allowlisted signup attribution (issue 1200, generalized in 2108).
 *
 * Funnel events stay anonymous and request-scoped. This module is the only
 * path that may persist a signup marker onto a user row. Callers pass the
 * raw `source=` query (or form field); only an allowlisted shape is stored:
 * an exact constant, a lowercase slug, or a `ref:<eTLD+1>` referer marker.
 * The raw query string and full URLs never land in SQL or in the cookie.
 *
 * The accepted shapes mirror the CHECK constraints rebuilt by migration
 * 0087_signup_source_open_allowlist.sql so code and D1 never disagree.
 */

export const SIGNUP_SOURCE_COOKIE = "f9_signup_source";
export const SIGNUP_SOURCE_TTL_MS = 24 * 60 * 60 * 1000;

export const LOCALE_SNEAKER_RESALE_SIGNUP_SOURCES = [
  "locale-en-sneaker-resale",
  "locale-de-sneaker-resale",
  "locale-ja-sneaker-resale",
  "locale-pt-br-sneaker-resale",
] as const;

/**
 * The exact signup-URL marker the /search warming-exhausted signup block
 * appends (issue 2134): a search whose 60s warming poll budget ran out offers
 * a create-account CTA so the first brief lands by email when the capture
 * finishes.
 */
export const SEARCH_WARMING_EXHAUSTED_SIGNUP_SOURCE = "search_warming_exhausted";

/**
 * The exact marker the /guides/how-to-track-competitor-ads guide carries on
 * its /search preview CTA (issue 2152): the guide is an organic-search entry
 * point, so a signup that starts from its preview is attributed to the guide.
 */
export const GUIDE_TRACK_ADS_SIGNUP_SOURCE = "guide_track_ads";

/**
 * The exact marker the /guides/how-to-monitor-meta-ad-library guide carries on
 * its /search preview CTA (issue 2867): the guide is an organic-search entry
 * point, so a signup that starts from its preview is attributed to the guide.
 * Hyphen slug — inside the open slug shape, so no migration literal needed.
 */
export const GUIDE_MONITOR_AD_LIBRARY_SIGNUP_SOURCE = "guide-monitor-ad-library";

/**
 * The exact marker the /guides/how-to-monitor-competitor-landing-page-changes
 * guide carries on its /search preview CTA (issue 2888): the guide is an
 * organic-search entry point, so a signup that starts from its preview is
 * attributed to the guide. Hyphen slug — inside the open slug shape, so no
 * migration literal needed.
 */
export const GUIDE_LANDING_PAGE_CHANGES_SIGNUP_SOURCE = "guide-landing-page-changes";

/**
 * /for-agencies CTA marker (issue #2144): the agency landing page's signup
 * link carries `source=for_agencies` so Agency-plan funnel measurement can
 * attribute checkout starts to that page.
 */
export const FOR_AGENCIES_SIGNUP_SOURCE = "for_agencies";

/**
 * /sample-brief CTA marker (issue #2136): the public sample Monday brief
 * page's signup link carries `source=sample_brief` so funnel measurement can
 * attribute signup starts to that page.
 */
export const SAMPLE_BRIEF_SIGNUP_SOURCE = "sample_brief";

export const ALLOWED_SIGNUP_SOURCES = [
  PRICING_FREE_SIGNUP_SOURCE,
  FOR_AGENCIES_SIGNUP_SOURCE,
  SAMPLE_BRIEF_SIGNUP_SOURCE,
  ...LOCALE_SNEAKER_RESALE_SIGNUP_SOURCES,
  SEARCH_WARMING_EXHAUSTED_SIGNUP_SOURCE,
  GUIDE_TRACK_ADS_SIGNUP_SOURCE,
  GUIDE_MONITOR_AD_LIBRARY_SIGNUP_SOURCE,
  GUIDE_LANDING_PAGE_CHANGES_SIGNUP_SOURCE,
] as const;

/**
 * Open allowlist shapes (issue #2108). Keep these in lockstep with the CHECK
 * constraints in migrations/0087_signup_source_open_allowlist.sql:
 * - slug: `/^[a-z0-9][a-z0-9-]{0,39}$/` (campaign markers, max 40 chars)
 * - referer marker: `/^ref:[a-z0-9.-]{1,40}$/` (`ref:` + eTLD+1, max 44 chars)
 * No free text, no uppercase, no query strings, no full URLs.
 */
const SIGNUP_SOURCE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SIGNUP_SOURCE_REF_PATTERN = /^ref:[a-z0-9.-]{1,40}$/;

export function allowlistedSignupSource(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if ((ALLOWED_SIGNUP_SOURCES as readonly string[]).includes(trimmed)) {
    return trimmed;
  }
  if (SIGNUP_SOURCE_SLUG_PATTERN.test(trimmed) || SIGNUP_SOURCE_REF_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function signupSourceFromRequest(request: Request, formSource?: string | null) {
  const urlSource = new URL(request.url).searchParams.get("source");
  return (
    allowlistedSignupSource(urlSource) ??
    allowlistedSignupSource(formSource) ??
    refererSignupSource(request)
  );
}

/**
 * Coarse referer attribution (issue #2108 step 2): when no `source=` matches,
 * keep only the referer's registrable domain (eTLD+1) as `ref:<domain>` —
 * never the full URL, path, or query string.
 */
function refererSignupSource(request: Request): string | null {
  const referer = request.headers.get("referer");
  if (!referer) {
    return null;
  }
  let hostname: string;
  try {
    hostname = new URL(referer).hostname;
  } catch {
    return null;
  }
  // Skip the site's own domain: a signup page resend or internal navigation
  // carries a self-referer that would otherwise clobber a previously-remembered
  // external attribution via the ON CONFLICT DO UPDATE in
  // rememberAllowlistedSignupSource (issue #2108 reviewer round).
  if (isOwnDomain(hostname)) {
    return null;
  }
  const domain = registrableDomainFromHostname(hostname);
  if (!domain) {
    return null;
  }
  return allowlistedSignupSource(`ref:${domain}`);
}

export function signupSourceCookieHeader(request: Request, source: string) {
  const parts = [
    `${SIGNUP_SOURCE_COOKIE}=${encodeURIComponent(source)}`,
    "HttpOnly",
    `Max-Age=${Math.floor(SIGNUP_SOURCE_TTL_MS / 1000)}`,
    "Path=/",
    "SameSite=Lax",
  ];
  const domain = signupSourceCookieDomain(request);
  if (domain) {
    parts.push(`Domain=${domain}`);
  }
  if (new URL(request.url).protocol === "https:") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function readSignupSourceCookie(request: Request): string | null {
  const prefix = `${SIGNUP_SOURCE_COOKIE}=`;
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const cookie = part.trim();
    if (!cookie.startsWith(prefix)) {
      continue;
    }
    try {
      return allowlistedSignupSource(decodeURIComponent(cookie.slice(prefix.length)));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Dual-write at signup start: keep the anonymous funnel event (caller), and
 * remember the allowlisted marker until the user row exists. Returns the
 * marker so the caller can also set the cookie (OAuth / same-browser).
 */
export async function rememberAllowlistedSignupSource(
  env: AppEnv,
  input: { email: string; source: string | null | undefined },
): Promise<string | null> {
  const source = allowlistedSignupSource(input.source);
  if (!source) {
    return null;
  }
  if (!env.DB) {
    return source;
  }
  const email = normalizeSignupEmail(input.email);
  if (!email) {
    return source;
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SIGNUP_SOURCE_TTL_MS).toISOString();
  try {
    await execute(
      env,
      `
        INSERT INTO signup_source_pending (email, signup_source, created_at, expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          signup_source = excluded.signup_source,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
      `,
      email,
      source,
      now.toISOString(),
      expiresAt,
    );
  } catch (error) {
    console.warn("failed to remember allowlisted signup_source", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
  return source;
}

/**
 * Copy the remembered marker onto the new user row. First write wins.
 * Never throws into Better Auth user-create.
 */
export async function applySignupSourceToNewUser(
  env: AppEnv,
  input: { user: { id: string; email?: string | null }; request?: Request },
): Promise<string | null> {
  const userId = input.user.id;
  if (!env.DB || !userId) {
    return null;
  }
  const email = normalizeSignupEmail(input.user.email ?? "");
  let source: string | null = null;
  if (email) {
    try {
      const row = await queryOne<{ signup_source: string }>(
        env,
        `
          SELECT signup_source
          FROM signup_source_pending
          WHERE email = ?
            AND expires_at > ?
          LIMIT 1
        `,
        email,
        new Date().toISOString(),
      );
      source = allowlistedSignupSource(row?.signup_source);
    } catch (error) {
      console.warn("failed to read pending signup_source", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }
  if (!source && input.request) {
    source = readSignupSourceCookie(input.request);
  }
  if (!source) {
    return null;
  }
  try {
    await execute(
      env,
      `
        UPDATE user
        SET signup_source = ?
        WHERE id = ?
          AND signup_source IS NULL
      `,
      source,
      userId,
    );
    if (email) {
      await execute(env, "DELETE FROM signup_source_pending WHERE email = ?", email);
    }
  } catch (error) {
    console.warn("failed to persist signup_source on user", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
  return source;
}

export async function readUserSignupSource(
  env: AppEnv,
  userId: string,
): Promise<string | null> {
  if (!env.DB || !userId) {
    return null;
  }
  const row = await queryOne<{ signup_source: string | null }>(
    env,
    "SELECT signup_source FROM user WHERE id = ? LIMIT 1",
    userId,
  );
  return allowlistedSignupSource(row?.signup_source);
}

function normalizeSignupEmail(value: string) {
  return value.trim().toLowerCase();
}

function signupSourceCookieDomain(request: Request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  if (hostname === "0509.io" || hostname.endsWith(".0509.io")) {
    return "0509.io";
  }
  if (hostname === "0509.in" || hostname.endsWith(".0509.in")) {
    return "0509.in";
  }
  return undefined;
}

function isOwnDomain(hostname: string) {
  const h = hostname.toLowerCase();
  return h === "0509.io" || h.endsWith(".0509.io") || h === "0509.in" || h.endsWith(".0509.in");
}
