// 0509 Netcup renderer — per-kind URL policy (SSRF-safe).
//
// Pure, dependency-free policy functions used by the renderer service and its
// focused tests. Every job kind gets exactly one policy:
//
//   meta_discovery   -> validateMetaUrl           (allowlisted host/path/query)
//   landing_snapshot -> validateLandingTarget + followRedirects (re-checks every hop)
//   report_pdf       -> validatePdfToken + buildShareUrl (worker-signed same-origin shape)
//
// Security posture: fail closed. Anything not explicitly allowed is rejected
// with a UrlPolicyError carrying a stable reason code.

const IPV4_BLOCKS = [
  // [network address, prefix length] — reject if inside.
  [0, 8], // 0.0.0.0/8 (this network / "this host")
  [0x0a000000, 8], // 10.0.0.0/8 (RFC1918)
  [0x64400000, 10], // 100.64.0.0/10 (CGNAT, RFC6598)
  [0x7f000000, 8], // 127.0.0.0/8 (loopback)
  [0xa9fe0000, 16], // 169.254.0.0/16 (link-local, incl. 169.254.169.254 metadata)
  [0xac100000, 12], // 172.16.0.0/12 (RFC1918)
  [0xc0a80000, 16], // 192.168.0.0/16 (RFC1918)
  [0xe0000000, 4], // 224.0.0.0/4 (multicast)
  [0xf0000000, 4], // 240.0.0.0/4 (reserved)
];

const IPV6_BLOCK_PREFIXES = [
  // [first address bytes, prefix length] — reject if inside.
  [0x00n, 128], // :: (unspecified)
  [0x00000000000000000000000000000001n, 128], // ::1 (loopback)
  [0xfc00n << 112n, 7], // fc00::/7 (ULA)
  [0xfe80n << 112n, 10], // fe80::/10 (link-local)
  [0xff00n << 112n, 8], // ff00::/8 (multicast)
  [0x2002n << 112n, 16], // 2002::/16 (6to4 — embeds IPv4; block entirely)
  [0x20010000n << 96n, 32], // 2001:0000::/32 (Teredo)
];

export class UrlPolicyError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "UrlPolicyError";
    this.code = code;
    this.status = status;
  }
}

export const META_ALLOWED_HOSTS = new Set(["www.facebook.com", "facebook.com"]);
export const META_ALLOWED_QUERY_PARAMS = new Set([
  "id",
  "active_status",
  "ad_type",
  "country",
  "is_targeted_country",
  "media_type",
  "search_type",
  "view_all_page_id",
  "q",
]);

const META_QUERY_VALUE_RULES = {
  id: /^\d{1,20}$/,
  view_all_page_id: /^\d{1,20}$/,
  country: /^[A-Z]{2}$/,
  active_status: /^[a-z_]{1,32}$/,
  ad_type: /^[a-z_]{1,32}$/,
  is_targeted_country: /^(true|false)$/,
  media_type: /^[a-z_]{1,32}$/,
  search_type: /^[a-z_]{1,64}$/,
  q: /^.{0,512}$/,
};

export const PDF_TOKEN_PATTERN = /^[0-9a-f]{32}$/i;
export const MAX_REDIRECTS = 5;

/** Parse a raw URL string; throws UrlPolicyError on anything unparsable. */
export function parseUrl(raw, reasonCode = "invalid_url") {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new UrlPolicyError(reasonCode, `unparsable URL: ${String(raw).slice(0, 256)}`);
  }
  return url;
}

/** Parse + return a URL object (throws if not http/https). */
export function parseHttpUrl(raw) {
  const url = parseUrl(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlPolicyError("scheme_not_allowed", `scheme ${url.protocol} not allowed`);
  }
  return url;
}

/** A public http(s) URL usable for landing_snapshot. Pure syntactic checks. */
export function assertPublicHttpUrl(url) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlPolicyError("scheme_not_allowed", `scheme ${url.protocol} not allowed`);
  }
  if (url.username || url.password) {
    throw new UrlPolicyError("url_credentials", "URL credentials are not allowed");
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (port !== 80 && port !== 443) {
    throw new UrlPolicyError("port_not_allowed", `port ${url.port} not allowed`);
  }
  if (!url.hostname) {
    throw new UrlPolicyError("missing_host", "URL has no host");
  }
  return url;
}

/** IPv4 dotted-quad -> number. Returns null if not a plain IPv4 literal. */
export function ipv4ToNumber(address) {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

/** True when the IPv4 literal is loopback/private/link-local/metadata/etc. */
export function isBlockedIpv4(address) {
  const num = ipv4ToNumber(address);
  if (num === null) return false; // not a literal — caller must resolve it
  for (const [network, prefix] of IPV4_BLOCKS) {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if ((num & mask) === (network & mask)) return true;
  }
  return false;
}

function ipv6ToBigInt(address) {
  // Normalize with the WHATWG parser (handles IPv4 tails like ::ffff:127.0.0.1)
  // then expand '::' compression explicitly.
  try {
    const u = new URL(`http://[${address}]/`);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    const halves = host.split("::");
    if (halves.length > 2) return null;
    let groups;
    if (halves.length === 2) {
      const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
      const right = halves[1] ? halves[1].split(":").filter(Boolean) : [];
      const missing = 8 - left.length - right.length;
      if (missing < 1) return null;
      groups = [...left, ...Array(missing).fill("0"), ...right];
    } else {
      groups = host.split(":").filter(Boolean);
    }
    if (groups.length !== 8) return null;
    let out = 0n;
    for (const group of groups) {
      const hex = group.padStart(4, "0");
      if (!/^[0-9a-f]{4}$/i.test(hex)) return null;
      out = (out << 16n) | BigInt(parseInt(hex, 16));
    }
    return out;
  } catch {
    return null;
  }
}

function inPrefix(value, firstBytes, prefixLen) {
  const shift = 128 - prefixLen;
  const mask = prefixLen === 0 ? 0n : ((1n << BigInt(prefixLen)) - 1n) << BigInt(shift);
  return (value & mask) === (firstBytes & mask);
}

/**
 * True when the IPv6 literal is loopback/private/link-local/multicast/reserved,
 * OR is an IPv4-mapped/NAT64 address whose embedded IPv4 is blocked.
 */
export function isBlockedIpv6(address) {
  const value = ipv6ToBigInt(address);
  if (value === null) return true; // unparsable IPv6 -> fail closed
  for (const [firstBytes, prefixLen] of IPV6_BLOCK_PREFIXES) {
    if (inPrefix(value, firstBytes, prefixLen)) return true;
  }
  // ::ffff:0:0/96 — IPv4-mapped (ffff in groups 1-6 top-96 bits, IPv4 in the
  // low 32 bits); check the embedded IPv4.
  if (inPrefix(value, 0xffffn << 32n, 96)) {
    const embedded = Number(value & 0xffffffffn);
    for (const [network, prefix] of IPV4_BLOCKS) {
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      if ((embedded & mask) === (network & mask)) return true;
    }
    return false;
  }
  // 64:ff9b::/96 — well-known NAT64 prefix (groups 1-6); check the embedded IPv4.
  if (inPrefix(value, 0x0064ff9bn << 96n, 96)) {
    const embedded = Number(value & 0xffffffffn);
    for (const [network, prefix] of IPV4_BLOCKS) {
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      if ((embedded & mask) === (network & mask)) return true;
    }
  }
  return false;
}

/** True when the string is a blocked IP of either family. */
export function isBlockedIp(address) {
  if (address.includes(":")) return isBlockedIpv6(address);
  return isBlockedIpv4(address);
}

/**
 * Resolve a hostname to every address (A + AAAA) and reject if ANY returned
 * address is blocked (DNS-rebinding defense: the first good + second bad
 * answer must still fail).
 */
export async function resolveHost(address, { lookup = defaultLookup } = {}) {
  const results = await lookup(address);
  if (!Array.isArray(results) || results.length === 0) {
    throw new UrlPolicyError("dns_failed", `host ${address} did not resolve`);
  }
  for (const result of results) {
    const ip = typeof result === "string" ? result : result.address;
    if (isBlockedIp(ip)) {
      throw new UrlPolicyError(
        "private_ip",
        `host ${address} resolves to blocked address ${ip}`,
      );
    }
  }
  return results;
}

async function defaultLookup(address) {
  const dns = await import("node:dns/promises");
  const records = await dns.lookup(address, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

/**
 * Full landing-target validation: parse -> public-http syntax -> DNS resolve ->
 * blocked-IP reject. Also rejects literal blocked IPs directly.
 */
export async function validateLandingTarget(raw, { lookup } = {}) {
  const url = assertPublicHttpUrl(parseHttpUrl(raw));
  if (isBlockedIp(url.hostname)) {
    throw new UrlPolicyError("private_ip", `literal address ${url.hostname} blocked`);
  }
  await resolveHost(url.hostname, { lookup });
  return url;
}

/**
 * Follow redirects manually, re-running full validation on EVERY hop.
 * Returns { url, status, headers, body } for the terminal response (non-3xx).
 * Fails on: no Location, malformed next URL, policy violation on any hop,
 * more than MAX_REDIRECTS hops.
 */
export async function followRedirects(raw, { maxRedirects = MAX_REDIRECTS, fetchImpl = defaultFetch, lookup, timeoutMs = 20000, signal } = {}) {
  let current = await validateLandingTarget(raw, { lookup });
  const effectiveSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  let redirects = 0;
  for (;;) {
    const response = await fetchImpl(current.toString(), {
      redirect: "manual",
      signal: effectiveSignal,
      headers: { "user-agent": "0509-netcup-renderer/0.1 (bounded landing probe)" },
    });
    const status = response.status;
    if (status < 300 || status > 399) {
      return { url: current, status, headers: response.headers, body: response.body, redirects };
    }
    if (redirects >= maxRedirects) {
      throw new UrlPolicyError("too_many_redirects", `more than ${maxRedirects} redirects`);
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new UrlPolicyError("redirect_no_location", `redirect ${status} without Location`);
    }
    // Resolve relative Location against the CURRENT url, then re-validate fully.
    redirects++;
    current = await validateLandingTarget(new URL(location, current).toString(), { lookup });
  }
}

async function defaultFetch(url, options) {
  return fetch(url, options);
}

// --- meta_discovery policy -------------------------------------------------

export function validateMetaUrl(raw) {
  const url = assertPublicHttpUrl(parseHttpUrl(raw));
  if (url.protocol !== "https:") {
    throw new UrlPolicyError("meta_scheme", "Meta Ad Library requires https");
  }
  if (!META_ALLOWED_HOSTS.has(url.hostname)) {
    throw new UrlPolicyError("meta_host", `host ${url.hostname} not on Meta Ad Library allowlist`);
  }
  const path = url.pathname;
  if (path !== "/ads/library/" && !path.startsWith("/ads/library/")) {
    throw new UrlPolicyError("meta_path", `path ${path} not under /ads/library/`);
  }
  for (const [key, value] of url.searchParams) {
    if (!META_ALLOWED_QUERY_PARAMS.has(key)) {
      throw new UrlPolicyError("meta_query", `query parameter ${key} not allowed`);
    }
    const rule = META_QUERY_VALUE_RULES[key];
    if (!rule || !rule.test(value)) {
      throw new UrlPolicyError("meta_query_value", `query parameter ${key} has invalid value`);
    }
  }
  if (url.username || url.password) {
    throw new UrlPolicyError("url_credentials", "URL credentials are not allowed");
  }
  return url;
}

// --- report_pdf policy -----------------------------------------------------

export function validatePdfToken(token) {
  if (typeof token !== "string" || !PDF_TOKEN_PATTERN.test(token)) {
    throw new UrlPolicyError(
      "pdf_token_invalid",
      "share token must be a 32-char hex id (0509 share token shape)",
    );
  }
  return token.toLowerCase();
}

/**
 * Build the canonical 0509 share URL from a VALIDATED token. Never trust a
 * client-supplied URL for the PDF kind — the URL is always reconstructed from
 * the signed token + configured same-origin.
 */
export function buildShareUrl(token, origin) {
  const validated = validatePdfToken(token);
  const url = new URL(`/share/${validated}`, origin);
  url.searchParams.set("pdf", "1");
  return url;
}
