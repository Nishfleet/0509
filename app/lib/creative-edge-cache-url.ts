/**
 * Issue #2393 — the client-safe half of the `/creative/:id` contract.
 *
 * `ad-creative.tsx` is a client component, so the URL shape has to live in a
 * module with no server imports. The server-side fetch/cache logic is in
 * `creative-edge-cache.server.ts` and imports these same predicates, so the
 * emitted URL and the served route can never drift.
 */

const CREATIVE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** A creative id is safe to embed in a same-origin path only in this shape. */
export function normalizeCreativeId(raw: string | null | undefined): string | null {
  const id = raw?.trim() ?? "";
  if (!id || !CREATIVE_ID_PATTERN.test(id) || id.includes("..") || id.includes("/")) {
    return null;
  }
  return id;
}

/**
 * Only fbcdn hosts get an edge-cached route. `host.endsWith(".fbcdn.net")` is
 * exact: it rejects `evil-fbcdn.net` and `fbcdn.net.attacker.test`, both of
 * which a naive `includes("fbcdn")` would accept.
 */
export function isFetchableFbcdnHost(hostname: string): boolean {
  return hostname.trim().toLowerCase().endsWith(".fbcdn.net");
}

/** True when the URL is an https `.fbcdn.net` asset we can edge-cache. */
export function isEdgeCacheableCreativeUrl(stored: string | null | undefined): boolean {
  const raw = stored?.trim() ?? "";
  if (!raw || !/^https:\/\//i.test(raw)) {
    return false;
  }
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && isFetchableFbcdnHost(url.hostname);
  } catch {
    return false;
  }
}

/**
 * True for ANY stored URL the browser would resolve to an fbcdn host — apex
 * `fbcdn.net` or a subdomain, over http, https, or scheme-relative. This is
 * the raw-render gate (issue #2730), deliberately broader than
 * `isEdgeCacheableCreativeUrl`: the edge route only fetches https subdomain
 * URLs, but an fbcdn URL of ANY shape must never be emitted as a raw
 * `<img src>` — it carries an expiring `oe=` signature, leaks a Meta
 * referrer, and bypasses every cache we control. The fallback base mirrors
 * browser resolution exactly: `//x.fbcdn.net/x` is scheme-relative and still
 * reaches fbcdn, while a bare path or bare `x.fbcdn.net/x` resolves
 * same-origin and is not an fbcdn hit.
 */
export function isFbcdnCreativeUrl(stored: string | null | undefined): boolean {
  const raw = stored?.trim() ?? "";
  if (!raw) {
    return false;
  }
  try {
    const url = new URL(raw, "https://fbcdn-gate.invalid");
    const host = url.hostname.toLowerCase();
    return host === "fbcdn.net" || host.endsWith(".fbcdn.net");
  } catch {
    return false;
  }
}

/**
 * The same-origin URL an `AdCreative` should emit for a captured creative.
 * Null when the id is unusable or the stored URL is not an edge-cacheable
 * fbcdn asset — the caller renders the honest mock for those, since an fbcdn
 * URL is never emitted raw (issue #2730).
 */
export function buildCreativeResourceUrl(
  metaAdId: string | null | undefined,
  storedImageUrl: string | null | undefined,
): string | null {
  const id = normalizeCreativeId(metaAdId);
  if (!id || !isEdgeCacheableCreativeUrl(storedImageUrl)) {
    return null;
  }
  return `/creative/${encodeURIComponent(id)}`;
}
