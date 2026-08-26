import { execute, queryOne } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import { MAGICBRIEF_MIGRATION_SOURCE } from "~/lib/funnel-measurement.server";

/**
 * Durable allowlisted signup attribution (issue 1200).
 *
 * Funnel events stay anonymous and request-scoped. This module is the only
 * path that may persist a signup marker onto a user row. Callers pass the
 * raw `source=` query (or form field); only an exact allowlisted constant
 * is stored. The raw query string never lands in SQL or in the cookie.
 */

export const SIGNUP_SOURCE_COOKIE = "f9_signup_source";
export const SIGNUP_SOURCE_TTL_MS = 24 * 60 * 60 * 1000;

export const LOCALE_SNEAKER_RESALE_SIGNUP_SOURCES = [
  "locale-en-sneaker-resale",
  "locale-de-sneaker-resale",
  "locale-ja-sneaker-resale",
  "locale-pt-br-sneaker-resale",
] as const;

export const ALLOWED_SIGNUP_SOURCES = [
  MAGICBRIEF_MIGRATION_SOURCE,
  ...LOCALE_SNEAKER_RESALE_SIGNUP_SOURCES,
] as const;

export type AllowedSignupSource = (typeof ALLOWED_SIGNUP_SOURCES)[number];

export function allowlistedSignupSource(
  raw: string | null | undefined,
): AllowedSignupSource | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  return ALLOWED_SIGNUP_SOURCES.find((source) => source === trimmed) ?? null;
}

export function signupSourceFromRequest(request: Request, formSource?: string | null) {
  const urlSource = new URL(request.url).searchParams.get("source");
  return allowlistedSignupSource(urlSource) ?? allowlistedSignupSource(formSource);
}

export function signupSourceCookieHeader(request: Request, source: AllowedSignupSource) {
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

export function readSignupSourceCookie(request: Request): AllowedSignupSource | null {
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
): Promise<AllowedSignupSource | null> {
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
): Promise<AllowedSignupSource | null> {
  const userId = input.user.id;
  if (!env.DB || !userId) {
    return null;
  }
  const email = normalizeSignupEmail(input.user.email ?? "");
  let source: AllowedSignupSource | null = null;
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
): Promise<AllowedSignupSource | null> {
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
