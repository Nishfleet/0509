import { createCookie } from "react-router";

import { execute, queryOne } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import {
  PRICING_FREE_SIGNUP_SOURCE,
  SEARCH_LIKELY_CONFIRM_SIGNUP_SOURCE,
} from "~/lib/funnel-measurement.server";
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

export const LOCALE_SNEAKER_RESALE_SIGNUP_SOURCES: readonly string[] = [];

export const SIGNUP_SOURCE_COOKIE = "f9_signup_source";
export const SIGNUP_SOURCE_TTL_MS = 24 * 60 * 60 * 1000;


/**
 * The exact signup-URL marker the /search warming-exhausted signup block
 * appends (issue 2134): a search whose 60s warming poll budget ran out offers
 * a create-account CTA so the first brief lands by email when the capture
 * finishes.
 */
export const SEARCH_WARMING_EXHAUSTED_SIGNUP_SOURCE = "search_warming_exhausted";

/**
 * The exact marker the /search Likely-match confirm control carries on its
 * signup link (issue 3306, BET 2 finish line): a signed-out visitor's
 * one-click "Yes, that's them" on a Likely-match row starts the signup intent
 * with the confirmed brand's context carried through, so the signup is
 * attributed to the search preview. Hyphen slug — inside the open slug
 * shape, so no migration literal needed. The constant itself lives next to
 * its funnel kind in funnel-measurement.server.ts (same module split as the
 * pricing-Free marker); only the allowlist membership is recorded here.
 */
/**
 * The exact marker the guide-pages/how-to-track-competitor-ads guide carries on
 * its /search preview CTA (issue 2152): the guide is an organic-search entry
 * point, so a signup that starts from its preview is attributed to the guide.
 */
export const GUIDE_TRACK_ADS_SIGNUP_SOURCE = "guide_track_ads";

/**
 * The exact marker the guide-pages/how-to-monitor-meta-ad-library guide carries on
 * its /search preview CTA (issue 2867): the guide is an organic-search entry
 * point, so a signup that starts from its preview is attributed to the guide.
 * Hyphen slug — inside the open slug shape, so no migration literal needed.
 */
export const GUIDE_MONITOR_AD_LIBRARY_SIGNUP_SOURCE = "guide-monitor-ad-library";

/**
 * The exact marker the guide-pages/how-to-monitor-competitor-landing-page-changes
 * guide carries on its /search preview CTA (issue 2888): the guide is an
 * organic-search entry point, so a signup that starts from its preview is
 * attributed to the guide. Hyphen slug — inside the open slug shape, so no
 * migration literal needed.
 */
export const GUIDE_LANDING_PAGE_CHANGES_SIGNUP_SOURCE = "guide-landing-page-changes";

/**
 * The exact markers the issue #3093 guides carry on their /search preview
 * CTAs: each guide is an organic-search entry point, so a signup that starts
 * from its preview is attributed to the guide. Hyphen slugs — inside the
 * open slug shape, so no migration literals needed.
 */
export const GUIDE_OFFER_CHANGE_ALERT_SIGNUP_SOURCE = "guide-offer-change-alert";
export const GUIDE_PROVE_WHAT_CHANGED_SIGNUP_SOURCE = "guide-prove-what-changed";
export const GUIDE_STANDING_WATCH_SIGNUP_SOURCE = "guide-standing-watch";

/**
 * The exact marker the guide-pages/meta-ad-library-api-limitations explainer
 * carries on its /search preview CTA (issue 3127): the guide is an
 * organic-search entry point, so a signup that starts from its preview is
 * attributed to the guide. Hyphen slug — inside the open slug shape, so no
 * migration literal needed.
 */
export const GUIDE_API_LIMITS_SIGNUP_SOURCE = "guide-api-limitations";

/**
 * The exact marker the guide-pages/can-ChatGPT-monitor-competitor-ads guide
 * carries on its /search preview CTA (issue 3421): the guide is an
 * organic-search entry point, so a signup that starts from its preview is
 * attributed to the guide. Hyphen slug — inside the open slug shape, so no
 * migration literal needed. Lowercase only: the marker pattern forbids
 * uppercase — the ChatGPT capitalisation lives in the PATH slug, never here.
 */
export const GUIDE_CAN_CHATGPT_MONITOR_ADS_SIGNUP_SOURCE = "guide-can-chatgpt-monitor-ads";

/**
 * Acquisition-surface-family markers (issue #3358): every public acquisition
 * family's signup CTA — the shared nav pill and each family's own signup
 * links — carries its ONE distinct family marker, so the #4518 signups/week
 * meter can slice signups by the surface that drove them. Hyphen slugs, on
 * purpose: they ride the open #2108 shape (and 0087's open CHECK class
 * [a-z0-9:.-]) — underscore spellings would need a 0087 CHECK literal, and
 * #3358 ships no migration. The guides family's per-article markers remain
 * the guide-<name> constants above; `guides-hub` marks the /guides hub.
 *
 * These constants are allowlist documentation for SERVER callers only —
 * client-rendered surfaces carry the same strings as literals. This module
 * statically imports d1.server, so a top-level `import ... from
 * "~/lib/signup-source"` in a route component or shared component pulls a
 * server-only module into the client graph and fails the react-router
 * dot-server build check. Same convention as `source=pricing-free` in
 * pricing-section.tsx: the literal ships in markup, the constant guards the
 * allowlist, and the #3358 wiring test pins every surface's literal.
 */
export const ADS_PAGE_SIGNUP_SOURCE = "ads-page";
export const COMPARE_PAGE_SIGNUP_SOURCE = "compare-page";
export const SWITCH_PAGE_SIGNUP_SOURCE = "switch-page";
export const TIMELINE_PAGE_SIGNUP_SOURCE = "timeline-page";
export const GUIDES_HUB_SIGNUP_SOURCE = "guides-hub";

/**
 * The 404/410 error-page marker (issue #3617). The error page is a genuine
 * acquisition surface: it is where every rotated-away /ads/<brand> link from a
 * directory, bio, or AI answer lands (#3496), and it now carries the signup
 * CTA. Its own marker keeps those signups out of the generic untagged bucket,
 * so the #4518 meter can say whether the recovery row actually converts.
 * Hyphen slug — inside the open #2108 shape, so no migration literal needed.
 */
export const ERROR_PAGE_SIGNUP_SOURCE = "error-page";

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

/**
 * Free-plan digest footer marker (issue #2146): the attribution line at the
 * foot of every free brief links `source=digest_footer` so funnel measurement
 * can attribute signup starts to the brief. Underscore literal — outside the
 * open slug shape, so it rides the exact-match branch and the 0087 CHECK
 * literal list.
 */
export const DIGEST_FOOTER_SIGNUP_SOURCE = "digest_footer";

export const ALLOWED_SIGNUP_SOURCES = [
  PRICING_FREE_SIGNUP_SOURCE,
  FOR_AGENCIES_SIGNUP_SOURCE,
  SAMPLE_BRIEF_SIGNUP_SOURCE,
  DIGEST_FOOTER_SIGNUP_SOURCE,
  ...LOCALE_SNEAKER_RESALE_SIGNUP_SOURCES,
  SEARCH_WARMING_EXHAUSTED_SIGNUP_SOURCE,
  SEARCH_LIKELY_CONFIRM_SIGNUP_SOURCE,
  GUIDE_TRACK_ADS_SIGNUP_SOURCE,
  GUIDE_MONITOR_AD_LIBRARY_SIGNUP_SOURCE,
  GUIDE_LANDING_PAGE_CHANGES_SIGNUP_SOURCE,
  GUIDE_OFFER_CHANGE_ALERT_SIGNUP_SOURCE,
  GUIDE_PROVE_WHAT_CHANGED_SIGNUP_SOURCE,
  GUIDE_STANDING_WATCH_SIGNUP_SOURCE,
  GUIDE_API_LIMITS_SIGNUP_SOURCE,
  GUIDE_CAN_CHATGPT_MONITOR_ADS_SIGNUP_SOURCE,
  ADS_PAGE_SIGNUP_SOURCE,
  COMPARE_PAGE_SIGNUP_SOURCE,
  SWITCH_PAGE_SIGNUP_SOURCE,
  TIMELINE_PAGE_SIGNUP_SOURCE,
  GUIDES_HUB_SIGNUP_SOURCE,
  ERROR_PAGE_SIGNUP_SOURCE,
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

/**
 * The signup-source cookie as a React Router `createCookie` (issue #3780) —
 * the framework owns the Set-Cookie string now. The request-scoped parts
 * (Domain on the 0509.io/0509.in apex, Secure on https) stay per-call
 * serialize options; name, HttpOnly, Path=/, SameSite=Lax and the 24h
 * Max-Age are fixed here. Note the framework's value codec replaces the old
 * `encodeURIComponent` payload — a pre-change cookie decodes to null, which
 * callers already treat as "no attribution remembered".
 */
const signupSourceCookie = createCookie(SIGNUP_SOURCE_COOKIE, {
  httpOnly: true,
  maxAge: Math.floor(SIGNUP_SOURCE_TTL_MS / 1000),
  path: "/",
  sameSite: "lax",
});

export function signupSourceCookieHeader(request: Request, source: string) {
  return signupSourceCookie.serialize(source, {
    domain: signupSourceCookieDomain(request),
    secure: new URL(request.url).protocol === "https:",
  });
}

export async function readSignupSourceCookie(request: Request): Promise<string | null> {
  const value = await signupSourceCookie.parse(request.headers.get("cookie"));
  return typeof value === "string" ? allowlistedSignupSource(value) : null;
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
    source = await readSignupSourceCookie(input.request);
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
