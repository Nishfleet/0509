/**
 * Pure domain-normalization helpers for the Five to Nine extension popup.
 *
 * Zero dependencies, no browser APIs — safe to unit-test from the app's
 * existing vitest setup without entangling the extension with the app build.
 */

const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)+$/;

/**
 * Normalize a hostname: lowercase, strip a single leading "www.", strip a
 * trailing dot. Returns null when the result is not a plausible public
 * hostname (needs at least one dot, valid label characters, no IP-only edge
 * handling beyond the pattern).
 *
 * @param {string} hostname
 * @returns {string | null}
 */
export function normalizeHostname(hostname) {
  if (typeof hostname !== "string") return null;
  let host = hostname.trim().toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.startsWith("www.")) host = host.slice(4);
  if (!HOSTNAME_PATTERN.test(host)) return null;
  return host;
}

/**
 * Extract a normalized domain from a full tab URL. Only http(s) tabs count —
 * chrome://, file://, about:, extension pages, etc. all return null so the
 * popup can fall back to manual entry.
 *
 * @param {string | undefined | null} url
 * @returns {string | null}
 */
export function domainFromTabUrl(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return normalizeHostname(parsed.hostname);
}

/**
 * Normalize free-typed input from the fallback field. Accepts bare domains
 * ("acme.com"), hosts with scheme/path ("https://www.acme.com/pricing"),
 * and sloppy paste-ins with whitespace. Returns null when nothing usable.
 *
 * @param {string} input
 * @returns {string | null}
 */
export function domainFromInput(input) {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (!text) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  return domainFromTabUrl(candidate);
}

/**
 * Build the three Five to Nine destination URLs for a normalized domain.
 *
 * @param {string} domain — already normalized (see normalizeHostname)
 * @returns {{ ads: string, search: string, watch: string }}
 */
export function buildDestinations(domain) {
  const site = `https://${domain}`;
  const setupPath = `/app?website=${encodeURIComponent(site)}#setup-checklist`;
  return {
    ads: `https://0509.io/ads/${encodeURIComponent(domain)}`,
    search: `https://0509.io/search?website=${encodeURIComponent(site)}`,
    watch: `https://0509.io/auth/signup?redirectTo=${encodeURIComponent(setupPath)}`,
  };
}
