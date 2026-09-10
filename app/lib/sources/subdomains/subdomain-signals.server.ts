/**
 * Subdomain signals via Certificate Transparency (crt.sh) — issue #2198.
 *
 * Every TLS certificate is written to public CT logs before a site goes
 * live. crt.sh aggregates those logs and exposes a JSON API. A new public
 * subdomain that appears in CT is an early signal that a competitor is
 * standing up a new product surface (beta., ai., app., …).
 *
 * This module is pure: it fetches, normalizes, and classifies. The adapter
 * (`subdomains.server.ts`) owns the D1 lookup and snapshot wiring; the
 * snapshot module (`subdomain-snapshot.server.ts`) owns the diff.
 */

/** Maximum entries to parse from a crt.sh response. */
const MAX_ENTRIES = 5000;
/** crt.sh is slow and flaky — one attempt, 60s budget. */
const FETCH_TIMEOUT_MS = 60_000;

export type SubdomainKind = "internal" | "public";

export interface SubdomainName {
  name: string;
  kind: SubdomainKind;
  /** Earliest certificate `not_before` for this name (ISO timestamp). */
  firstSeen: string;
}

export interface SubdomainFetchResult {
  unavailable?: false;
  names: SubdomainName[];
  truncated: boolean;
}

export interface SubdomainUnavailable {
  unavailable: true;
  reason: string;
}

export type SubdomainResult = SubdomainFetchResult | SubdomainUnavailable;

interface CrtShEntry {
  name_value: string;
  not_before: string;
  not_after?: string;
  issuer_name?: string;
  id?: number;
}

/**
 * Classification regex — a subdomain is "internal" (infrastructure, not a
 * product signal) when the leftmost label matches one of these exact names
 * or carries a -dev/-stg/-staging/-prod suffix. Everything else is "public"
 * — a potentially customer-facing new address.
 *
 * The list is deliberately conservative: mail/smtp/imap/autodiscover are
 * email infrastructure; ns/mx/cf/cdn are DNS/CDN; admin/vpn/internal are
 * ops; dev/stg/staging/stage/test/qa/uat/sandbox/preview are
 * pre-production. A leading underscore (_*) is a DNS TXT/verification
 * record, never a web address.
 */
const INTERNAL_LABEL_RE =
  /^(dev|stg|staging|stage|test|qa|uat|sandbox|preview|internal|admin|vpn|mail|smtp|imap|autodiscover|cf|cdn\d*|ns\d*|mx\d*|_.*)$/;

const INTERNAL_SUFFIX_RE = /(?:-dev|-stg|-staging|-prod)$/;

/**
 * Fetch subdomains from crt.sh CT logs for a registrable domain.
 *
 * One attempt, 60s timeout. Treats 5xx/timeout/non-JSON as unavailable
 * (never throws). Caps at 5,000 entries and records `truncated: true`.
 *
 * `fetchImpl` is injectable for testing; production uses the global `fetch`.
 */
export async function fetchSubdomains(
  registrableDomain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SubdomainResult> {
  const domain = registrableDomain.trim().toLowerCase();
  if (!domain) {
    return { unavailable: true, reason: "empty_domain" };
  }

  // URL-encode the leading %. per the issue's verified request format.
  const url = `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json&exclude=expired`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
  } catch {
    return { unavailable: true, reason: "fetch_failed" };
  }

  if (!response.ok) {
    return { unavailable: true, reason: `http_${response.status}` };
  }

  let entries: unknown;
  try {
    entries = await response.json();
  } catch {
    return { unavailable: true, reason: "non_json" };
  }

  if (!Array.isArray(entries)) {
    return { unavailable: true, reason: "non_json" };
  }

  const truncated = entries.length > MAX_ENTRIES;
  const capped = truncated ? (entries as CrtShEntry[]).slice(0, MAX_ENTRIES) : (entries as CrtShEntry[]);

  // Normalize: lowercase, split name_value on newlines, strip leading *.,
  // drop the apex itself and anything not ending in .<domain>, dedupe,
  // keep min(not_before) as firstSeen.
  const firstSeenByDomain = new Map<string, string>();

  for (const entry of capped) {
    if (!entry || typeof entry.name_value !== "string") continue;
    for (const rawName of entry.name_value.split("\n")) {
      let name = rawName.trim().toLowerCase();
      if (!name) continue;
      if (name.startsWith("*.")) {
        name = name.slice(2);
      }
      if (name === domain) continue;
      if (!name.endsWith(`.${domain}`)) continue;
      const firstSeen = entry.not_before ?? "";
      const existing = firstSeenByDomain.get(name);
      if (existing === undefined || (firstSeen && firstSeen < existing)) {
        firstSeenByDomain.set(name, firstSeen);
      }
    }
  }

  const names: SubdomainName[] = [];
  for (const [name, firstSeen] of firstSeenByDomain) {
    names.push({
      name,
      kind: classifySubdomain(name),
      firstSeen,
    });
  }

  // Newest first — the display path shows the most recent entries.
  names.sort((a, b) => b.firstSeen.localeCompare(a.firstSeen));

  return { names, truncated };
}

/**
 * Classify a subdomain as "internal" or "public". Internal names are
 * infrastructure / pre-production labels that rarely indicate a new
 * product launch. Public names are potentially customer-facing.
 */
export function classifySubdomain(name: string): SubdomainKind {
  const leftmost = name.split(".")[0] ?? "";
  if (INTERNAL_LABEL_RE.test(leftmost)) {
    return "internal";
  }
  if (INTERNAL_SUFFIX_RE.test(leftmost)) {
    return "internal";
  }
  return "public";
}
