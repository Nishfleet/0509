import { reserveDecodoBudget } from "~/lib/decodo-budget.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  SerpAd,
  SerpOrganic,
  SerpProvider,
  SerpResult,
  SerpUnavailable,
} from "~/lib/sources/google-search/serp-provider";

/**
 * Decodo SERP provider (#2181, seam #2218).
 *
 * One POST to Decodo's `/v2/scrape` with the `google_search` target, one
 * attempt, 60s timeout. Decodo returns Google's own result object already
 * parsed when `parse: true` is set, so this module only normalizes that shape
 * into `SerpResult` and fails closed with a machine-readable reason.
 *
 * Request body is exactly `{ target, query, parse, geo, locale }`.
 *
 * There is deliberately NO `proxy_pool` key. The ticket asked for
 * `"proxy_pool": "standard"` (the value the `universal` target takes) and the
 * live API rejects it for this target with HTTP 400. Verbatim probe body:
 * {"status":"failed","message":"Bad request","errors":[{"parameter":"proxy_pool","message":"\"proxy_pool\" parameter customization is only supported in the Universal Web Scraping target."}]}
 * That body is committed as
 * tests/fixtures/google-search/decodo-error-400-proxy-pool.json. The official
 * Google Search template lists no `proxy_pool`.
 *
 * The `paid` block only ever came back empty from live probes, so the ad
 * mapper is covered by a synthetic body in the test file and is written from
 * the documented row shape rather than a capture.
 *
 * The auth token is never logged, never returned, and never part of a result.
 */

const DECODO_SCRAPE_URL = "https://scraper-api.decodo.com/v2/scrape";
/** Request timeout used when the caller injects no `timeoutMs`. */
export const DECODO_SERP_DEFAULT_TIMEOUT_MS = 60_000;

/**
 * The Decodo success set, used for every status field the response carries:
 * 200 (the generic success code) and 12000 (Decodo's `google_search` success
 * code). Any other value is a failure.
 *
 * The ticket said "`parse_status_code` present and !== 200 -> parse break".
 * That literal test is wrong against the live API: every real `google_search`
 * capture under tests/fixtures/google-search/ returns
 * `content.results.parse_status_code: 12000`, `content.status_code: 12000`
 * and `results[0].status_code: 200` for a perfectly good parse, so `!== 200`
 * would mark every real response a parse break. 200 is tolerated everywhere
 * because rejecting the generic success code would buy nothing.
 */
const DECODO_OK_STATUSES: readonly number[] = [200, 12_000];

/**
 * The Decodo `/v2/scrape` request body for the Google Search target.
 * Key order is the documented order; the value is a plain JSON string because
 * the caller only ever puts it on the wire.
 */
export function buildDecodoRequestBody(query: string): string {
  return JSON.stringify({
    target: "google_search",
    query,
    parse: true,
    geo: "United States",
    locale: "en-US",
  });
}

/**
 * Normalize a Decodo `/v2/scrape` response into a `SerpResult`, or explain in
 * one stable reason why it cannot be normalized. Pure: no IO, no clock, no
 * logging. `fetchedAt` is passed in so the result is deterministic.
 *
 * Failure reasons, in the order they are checked:
 *   - `decodo_status_<code>`   a top-level `status` that is not a success
 *                              code while no `results` array is present
 *   - `decodo_no_result`       no `results[0]`
 *   - `decodo_status_<code>`   `results[0].status_code` or
 *                              `results[0].content.status_code` present and
 *                              not a success code
 *   - `decodo_parse_break`     `content.errors` non-empty, no
 *                              `content.results`, no
 *                              `content.results.results`, or a
 *                              `parse_status_code` that is not a success code
 *
 * An empty or absent `organic`/`paid` block is NOT a failure: it is a real
 * "Google returned nothing there". `knowledge`, `navigation`,
 * `related_questions`, `related_searches`, `popular_products`, `local_pack`
 * and `sitelinks` are ignored on purpose — this source watches the ranked
 * lists, not the extras.
 */
export function mapDecodoResponse(
  json: unknown,
  input: { query: string; fetchedAt: string },
): SerpResult | SerpUnavailable {
  // Decodo reports its own failures as a top-level `{"status":<code>,
  // "message":"..."}` body (e.g. 613 "quota exceeded"), with no `results`
  // array at all. Checked first so that shape gets its real code instead of
  // being reported as `decodo_no_result`.
  const rootStatus = finiteNumber(asRecord(json)?.status);
  if (
    rootStatus !== null &&
    !DECODO_OK_STATUSES.includes(rootStatus) &&
    !Array.isArray(asRecord(json)?.results)
  ) {
    return { unavailable: true, reason: `decodo_status_${rootStatus}` };
  }

  const first = firstDecodoResult(json);
  if (!first) {
    return { unavailable: true, reason: "decodo_no_result" };
  }

  const statusCode = finiteNumber(first.status_code);
  if (statusCode !== null && !DECODO_OK_STATUSES.includes(statusCode)) {
    return { unavailable: true, reason: `decodo_status_${statusCode}` };
  }

  const content = asRecord(first.content);

  // `content.status_code` is the parse task's own status and
  // `content.errors` its error list; both are checked so a failed parse can
  // never leave this mapper as a successful empty SERP.
  const contentStatus = finiteNumber(content?.status_code);
  if (contentStatus !== null && !DECODO_OK_STATUSES.includes(contentStatus)) {
    return { unavailable: true, reason: `decodo_status_${contentStatus}` };
  }
  const contentErrors = content?.errors;
  if (Array.isArray(contentErrors) && contentErrors.length > 0) {
    return { unavailable: true, reason: "decodo_parse_break" };
  }

  const parsed = content ? asRecord(content.results) : null;
  if (!parsed) {
    return { unavailable: true, reason: "decodo_parse_break" };
  }

  const parseStatus = finiteNumber(parsed.parse_status_code);
  if (parseStatus !== null && !DECODO_OK_STATUSES.includes(parseStatus)) {
    return { unavailable: true, reason: "decodo_parse_break" };
  }

  const blocks = asRecord(parsed.results);
  if (!blocks) {
    return { unavailable: true, reason: "decodo_parse_break" };
  }

  return {
    query: input.query,
    fetched_at: input.fetchedAt,
    provider: "decodo",
    ads: mapAds(blocks.paid),
    organic: mapOrganic(blocks.organic),
  };
}

export interface DecodoSerpProviderDeps {
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected clock, used for `fetched_at`. */
  now?: () => Date;
  /** Request timeout; defaults to 60s. */
  timeoutMs?: number;
}

/**
 * Build the Decodo-backed provider.
 *
 * `search()` fails closed on a missing credential FIRST: a blank
 * `DECODO_SCRAPER_AUTH` returns `{ unavailable: true, reason:
 * "not_configured" }` before the budget reservation and before any fetch, so
 * an unconfigured deploy cannot spend quota or send an anonymous request that
 * the API answers with 401.
 *
 * A configured `search()` then reserves the standard-page budget BEFORE
 * anything else. A denied reservation returns `{ unavailable: true,
 * reason: "quota" }` and makes NO network call, so a spent month costs zero
 * requests.
 */
export function createDecodoSerpProvider(
  env: AppEnv,
  deps: DecodoSerpProviderDeps = {},
): SerpProvider {
  return {
    async search(input: {
      query: string;
      gl: "us";
      hl: "en";
    }): Promise<SerpResult | SerpUnavailable> {
      // Credential first: without it the request cannot succeed, and the
      // reservation below is a real quota decrement.
      const auth = env.DECODO_SCRAPER_AUTH;
      if (typeof auth !== "string" || auth.trim() === "") {
        return { unavailable: true, reason: "not_configured" };
      }

      // Budget next: the reservation is the only gate on the free monthly
      // quota, and it must happen before the request can cost anything.
      const budget = await reserveDecodoBudget(env, "std");
      if (!budget.ok) {
        return { unavailable: true, reason: "quota" };
      }

      // The seam fixes gl:"us" / hl:"en"; the Decodo `google_search` target
      // spells those `geo` / `locale` in the body (see
      // buildDecodoRequestBody), so they are not sent as separate fields.
      const fetchImpl = deps.fetchImpl ?? fetch;
      let response: Response;
      try {
        response = await fetchImpl(DECODO_SCRAPE_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Basic ${auth}`,
          },
          body: buildDecodoRequestBody(input.query),
          signal: AbortSignal.timeout(deps.timeoutMs ?? DECODO_SERP_DEFAULT_TIMEOUT_MS),
        });
      } catch {
        // Network error or timeout abort. ONE attempt: no retry, no backoff.
        return { unavailable: true, reason: "fetch_error" };
      }

      // Status before body: a non-2xx response is not guaranteed to carry
      // JSON (an edge proxy can answer with HTML), and reporting
      // `decodo_http_<status>` keeps the real cause instead of masking it as
      // a JSON problem. For a 2xx, an unparseable body is `decodo_bad_json`.
      if (!response.ok) {
        return { unavailable: true, reason: `decodo_http_${response.status}` };
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        return { unavailable: true, reason: "decodo_bad_json" };
      }

      const fetchedAt = (deps.now?.() ?? new Date()).toISOString();
      return mapDecodoResponse(json, { query: input.query, fetchedAt });
    },
  };
}

function firstDecodoResult(json: unknown): Record<string, unknown> | null {
  const root = asRecord(json);
  const results = root ? asArray(root.results) : [];
  return results.length > 0 ? asRecord(results[0]) : null;
}

function mapOrganic(raw: unknown): SerpOrganic[] {
  const organic: SerpOrganic[] = [];
  asArray(raw).forEach((row, index) => {
    const record = asRecord(row);
    if (!record) return;
    const target = httpUrl(record.url);
    // A row without a usable http(s) url is not a result we can link to or
    // diff, so it is dropped rather than stored half-formed.
    if (!target) return;
    organic.push({
      // `pos` is the rank inside the organic block, `pos_overall` the rank on
      // the page; the ticket orders `pos` first.
      position: rowPosition(record, index),
      domain: target.host,
      title: asText(record.title),
      url: target.href,
      snippet: asText(record.desc),
    });
  });
  return organic;
}

function mapAds(raw: unknown): SerpAd[] {
  const ads: SerpAd[] = [];
  asArray(raw).forEach((row, index) => {
    const record = asRecord(row);
    if (!record) return;
    // The displayed host is the advertiser for a paid row; fall back to the
    // click-through url when the displayed string is not a host at all
    // ("Sponsored", "2.3M+ followers").
    const clickTarget = httpUrl(record.url);
    const advertiserDomain = displayHost(record.url_shown) ?? clickTarget?.host ?? null;
    if (!advertiserDomain) return;
    ads.push({
      position: rowPosition(record, index),
      advertiser_domain: advertiserDomain,
      title: asText(record.title),
      // The row is kept (its advertiser is known) but a relative click url
      // such as `/goto?url=...` is not a link we can store: rendered as-is it
      // points back at our own page. Only an absolute http(s) url is kept.
      url: clickTarget?.href ?? "",
      snippet: asText(record.desc),
    });
  });
  return ads;
}

function rowPosition(row: Record<string, unknown>, index: number): number {
  return finiteNumber(row.pos) ?? finiteNumber(row.pos_overall) ?? index + 1;
}

/** A usable http(s) result url, with the host normalized for storage. */
function httpUrl(raw: unknown): { href: string; host: string } | null {
  if (typeof raw !== "string") return null;
  const href = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return { href, host: stripWww(parsed.hostname) };
}

/**
 * Host of a Google-displayed string (`url_shown`), which is either an absolute
 * url or a bare host such as "www.example.com". Anything before the first
 * `/`, `?` or `#` is taken as the host, so a display string that still
 * carries a path keeps working; there is no breadcrumb parsing, so a
 * "example.com › page" string is read as one dot-less token and rejected
 * rather than turned into a host. A string with no dot in its host part is
 * not a host ("Sponsored"), and the organic block's `url_shown` strings are
 * display text, not hosts — this is only ever called for paid rows.
 */
function displayHost(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;

  const absolute = httpUrl(value);
  if (absolute) return absolute.host;

  const hostPart = value.split(/[/?#]/)[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(hostPart)) return null;
  return stripWww(hostPart.toLowerCase());
}

function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** Number, or a numeric string, or null. Keeps `"613"` from reading as absent. */
function finiteNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function asText(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function asArray(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}
