import type { AppEnv } from "~/lib/env.server";
import { queryAll } from "~/lib/data/d1.server";

/**
 * Price-tier distribution over the tracked-competitors landing-page corpus
 * (issue #1279). The four EUR bands — `<€30`, `€30–€100`, `€100–€250`,
 * `>€250` — give the daily digest a "Value-tier swing" section that never
 * has to re-fetch a page: the band is computed once at capture time and
 * stored on the `landing_page_snapshot.price_tier` column
 * (migration 0086).
 *
 * Deterministic, no LLM. The extractor is a pure function over `price_text`;
 * it has no network access, no environment access, and no LLM call. The
 * band boundary mapping is hard-coded and the currency conversion is a
 * fixed table (USD → EUR at 0.92, GBP → EUR at 1.17). The constants are
 * deliberately frozen here so two parallel runs of the same capture
 * produce the same band id for the same input — re-classifying a row
 * twice must be safe.
 *
 * Honest-accounting policy: rows whose `price_text` does not parse cleanly
 * are bucketed as `"unknown"` and excluded from the four named-band
 * totals. The distribution returned by `loadPriceTierDistribution` is
 * therefore a partial picture by design — the four named-band counts sum
 * only to the rows that were successfully parsed, never to the corpus
 * total. Phase 2 will populate `price_tier` at INSERT time so new captures
 * are always classified; legacy rows stay NULL until the monitoring
 * workflow re-captures them, which is the same outcome as `"unknown"` for
 * the aggregate.
 */

export type PriceTierBucket =
  | "under_30"
  | "30_to_100"
  | "100_to_250"
  | "over_250"
  | "unknown";

export type PriceTierDistribution = Record<PriceTierBucket, number>;

export interface PriceTierBand {
  id: Exclude<PriceTierBucket, "unknown">;
  label: string;
  /** Inclusive lower bound in EUR. */
  lowerInclusiveEur: number;
  /** Exclusive upper bound in EUR, or `null` for the open-ended top band. */
  upperExclusiveEur: number | null;
}

/**
 * The four named bands, in ascending order. Excludes `"unknown"`, which is
 * not a band — it is the "did not parse" bucket. The explicit
 * `upperExclusiveEur: null` on `over_250` makes the open-ended top band
 * self-documenting at every call site.
 */
export const PRICE_TIER_BANDS: ReadonlyArray<PriceTierBand> = [
  { id: "under_30", label: "<€30", lowerInclusiveEur: 0, upperExclusiveEur: 30 },
  { id: "30_to_100", label: "€30–€100", lowerInclusiveEur: 30, upperExclusiveEur: 100 },
  { id: "100_to_250", label: "€100–€250", lowerInclusiveEur: 100, upperExclusiveEur: 250 },
  { id: "over_250", label: ">€250", lowerInclusiveEur: 250, upperExclusiveEur: null },
];

/**
 * Fixed FX rates for the currencies the extractor recognises. EUR is the
 * reference currency — no conversion is applied to EUR inputs. USD and GBP
 * use deliberately-rounded constants so re-classification is bit-for-bit
 * stable across runs and across environments. The rounding is documented
 * here, not derived from a live feed, so the audit trail of "which band did
 * this row land in" is reproducible from the row's `price_text` alone.
 */
const USD_TO_EUR = 0.92;
const GBP_TO_EUR = 1.17;

/**
 * Currency markers the extractor does not recognise, uppercased. If any
 * appears in `price_text` (checked case-insensitively against the
 * uppercased input), `parsePriceToEur` returns `null` rather than
 * assuming the value is EUR — the extractor never invents an FX rate.
 * `₹` and `¥` are matched literally; the codes are matched against the
 * uppercased input, so every marker MUST be stored already uppercased.
 * The two `Rs` forms cover both "Rs.1,999" and "Rs 1,999" once
 * uppercased ("RS." / "RS ").
 */
const UNRECOGNISED_CURRENCY_MARKERS = [
  "₹",
  "RS.",
  "RS ",
  "INR",
  "¥",
  "JPY",
  "CNY",
  "AUD",
  "CAD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "RUB",
  "KRW",
] as const;

/**
 * Match the first numeric run in the input — digits with optional decimal
 * point and thousands separators. Examples:
 *
 *   "€30"        → "30"
 *   "$199"       → "199"
 *   "£1,500.99"  → "1,500.99"
 *   "from $9.99" → "9.99"
 *
 * Strings without any digit (e.g. "free", "") never match and the
 * extractor falls back to `"unknown"`.
 */
const PRICE_NUMERIC_REGEX = /\d[\d,]*(?:\.\d+)?/;

/**
 * Parse `price_text` into a numeric EUR value. Returns `null` when the
 * input carries no parseable number or when the currency marker is one
 * the extractor does not recognise — the extractor never invents an FX
 * rate. Unrecognised currency markers (₹/INR, Rs, ¥/JPY/CNY, AUD, CAD,
 * CHF, SEK, NOK, DKK, RUB, KRW) return null; only EUR, USD, GBP, or no
 * marker are recognised. When no currency marker is present at all, the
 * value is assumed to already be in EUR (the issue spec).
 *
 * Accepts the symbols and codes `€`, `£`, `$`, `USD`, `EUR`, `GBP` in any
 * case. Currency detection is case-insensitive on the codes; the
 * punctuation symbols are matched literally.
 */
export function parsePriceToEur(priceText: string): number | null {
  const numericMatch = priceText.match(PRICE_NUMERIC_REGEX);
  if (!numericMatch) {
    return null;
  }
  const stripped = numericMatch[0].replace(/,/g, "");
  const value = Number(stripped);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  const upper = priceText.toUpperCase();
  // Unrecognised currency markers must return null (never assume EUR), so
  // the check comes before the USD/GBP/EUR branches: "₹1999" must not
  // silently become 1999 EUR.
  for (const marker of UNRECOGNISED_CURRENCY_MARKERS) {
    if (upper.includes(marker)) {
      return null;
    }
  }
  // Order matters: check the more specific markers first so a string like
  // "USD $199" picks USD over the literal `$`.
  if (upper.includes("USD") || priceText.includes("$")) {
    return value * USD_TO_EUR;
  }
  if (upper.includes("GBP") || priceText.includes("£")) {
    return value * GBP_TO_EUR;
  }
  // EUR (€, EUR) or no currency marker at all → assume EUR.
  return value;
}

/**
 * Pure deterministic bucket lookup. Null / empty inputs and unparseable
 * prices land in `"unknown"`; everything else lands in one of the four
 * named bands. The boundary semantics match the issue spec:
 *
 *   < 30          → "under_30"
 *   [30, 100)     → "30_to_100"
 *   [100, 250)    → "100_to_250"
 *   >= 250        → "over_250"
 *
 * Boundary spot-checks:
 *
 *   "€30"  → 30 EUR        → "30_to_100"   (30 is inclusive in this band)
 *   "€250" → 250 EUR       → "over_250"    (250 is inclusive in this band)
 *   "£250" → 292.50 EUR    → "over_250"    (USD/GBP conversion applied)
 *   "$199" → 183.08 EUR    → "100_to_250"
 *   "from $9.99" → 9.19 EUR → "under_30"
 */
export function extractPriceTier(priceText: string | null | undefined): PriceTierBucket {
  if (priceText === null || priceText === undefined || priceText.trim() === "") {
    return "unknown";
  }
  const eur = parsePriceToEur(priceText);
  if (eur === null) {
    return "unknown";
  }
  if (eur < 30) return "under_30";
  if (eur < 100) return "30_to_100";
  if (eur < 250) return "100_to_250";
  return "over_250";
}

/**
 * Bounded D1 read: one `SELECT ... GROUP BY price_tier` query. The column
 * carries at most five distinct values (the four named bands plus
 * `unknown`/NULL), so the result is always ≤ 5 rows regardless of corpus
 * size — the query cost is independent of `landing_page_snapshot` row
 * count. The returned object always has all five buckets present (zero
 * where the database has no rows), so callers can index it without a
 * defensive nullish check.
 *
 * NULL `price_tier` rows are bucketed into `"unknown"` — they are the
 * legacy rows that pre-date the column (migration 0086, phase 1) and the
 * rows whose `price_text` was NULL at INSERT time. Per the module header,
 * `unknown` is excluded from the four named-band totals.
 */
export async function loadPriceTierDistribution(
  env: AppEnv,
): Promise<PriceTierDistribution> {
  const distribution: PriceTierDistribution = {
    under_30: 0,
    "30_to_100": 0,
    "100_to_250": 0,
    over_250: 0,
    unknown: 0,
  };
  type Row = { price_tier: string | null; count: number };
  const rows = await queryAll<Row>(
    env,
    "SELECT price_tier, COUNT(*) AS count FROM landing_page_snapshot GROUP BY price_tier",
  );
  for (const row of rows) {
    const bucket = row.price_tier;
    if (
      bucket === "under_30" ||
      bucket === "30_to_100" ||
      bucket === "100_to_250" ||
      bucket === "over_250"
    ) {
      distribution[bucket] = Number(row.count) || 0;
    } else {
      // NULL price_tier (legacy rows) and any unrecognised price_tier
      // string both count into `unknown` — honest accounting, never a
      // silently dropped row.
      distribution.unknown += Number(row.count) || 0;
    }
  }
  return distribution;
}

/**
 * Same shape as `loadPriceTierDistribution`, restricted to snapshots
 * captured at or after `sinceIso`. NULL / unrecognised tiers bucket into
 * `unknown`, exactly as the all-time read does.
 */
export async function loadPriceTierDistributionSince(
  env: AppEnv,
  sinceIso: string,
): Promise<PriceTierDistribution> {
  const distribution: PriceTierDistribution = {
    under_30: 0,
    "30_to_100": 0,
    "100_to_250": 0,
    over_250: 0,
    unknown: 0,
  };
  type Row = { price_tier: string | null; count: number };
  const rows = await queryAll<Row>(
    env,
    "SELECT price_tier, COUNT(*) AS count FROM landing_page_snapshot WHERE captured_at >= ?1 GROUP BY price_tier",
    sinceIso,
  );
  for (const row of rows) {
    const bucket = row.price_tier;
    if (
      bucket === "under_30" ||
      bucket === "30_to_100" ||
      bucket === "100_to_250" ||
      bucket === "over_250"
    ) {
      distribution[bucket] = Number(row.count) || 0;
    } else {
      distribution.unknown += Number(row.count) || 0;
    }
  }
  return distribution;
}

export interface PriceTierSwing {
  /** All-time four-band distribution (the counts the section renders). */
  distribution: PriceTierDistribution;
  /** Same distribution restricted to the last 24h of captures. */
  last24h: PriceTierDistribution;
  /**
   * Number of tracked pages whose band moved INTO or OUT OF the `over_250`
   * (trainerflation) band, where the newer capture of the pair falls inside
   * the last-24h window.
   */
  swingCount: number;
  /** Inclusive window start (`nowIso` minus 24h), for the section copy. */
  windowStartIso: string;
}

/**
 * The read-switch consumer for the digest's "Value-tier swing" section
 * (issue #1976, phase 3 of the #1279 expand/contract sequence). Three
 * bounded reads:
 *
 * 1. the all-time distribution (`loadPriceTierDistribution`),
 * 2. the last-24h distribution (second aggregate over
 *    `captured_at >= now-24h`, as the issue prescribes),
 * 3. the swing count — one windowed query that pairs each page's latest
 *    snapshot with its immediately preceding snapshot and counts the
 *    distinct pages where exactly one side of the pair sits in the
 *    `over_250` band and the newer capture is inside the 24h window.
 *
 * `captured_at` is an ISO-8601 TEXT column, so the window comparison is a
 * plain lexicographic string compare against an ISO timestamp — no date
 * functions, no timezone drift. The swing query is bounded the same way as
 * the distributions: SQLite 3.25+ window functions are available in D1,
 * and the result is a single scalar row regardless of corpus size. The
 * LAG ordering carries `id` as a tiebreaker so two snapshots of the same
 * page sharing a `captured_at` still yield a deterministic "previous band".
 *
 * A page whose FIRST snapshot ever lands in the window has no previous
 * band to compare, so it is never counted as a swing — a new page is not
 * a price move.
 */
export async function loadPriceTierSwing(
  env: AppEnv,
  nowIso: string = new Date().toISOString(),
): Promise<PriceTierSwing> {
  const windowStartMs = Date.parse(nowIso) - 24 * 60 * 60 * 1000;
  const windowStartIso = new Date(windowStartMs).toISOString();

  const [distribution, last24h, swingRows] = await Promise.all([
    loadPriceTierDistribution(env),
    loadPriceTierDistributionSince(env, windowStartIso),
    queryAll<{ swing: number }>(
      env,
      `WITH ordered AS (
         SELECT canonical_url,
                price_tier,
                captured_at,
                LAG(price_tier) OVER (
                  PARTITION BY canonical_url ORDER BY captured_at, id
                ) AS prev_tier
         FROM landing_page_snapshot
       )
       SELECT COUNT(DISTINCT canonical_url) AS swing
       FROM ordered
       WHERE captured_at >= ?1
         AND price_tier IN ('under_30', '30_to_100', '100_to_250', 'over_250')
         AND prev_tier IN ('under_30', '30_to_100', '100_to_250', 'over_250')
         AND (price_tier = 'over_250') != (prev_tier = 'over_250')`,
      windowStartIso,
    ),
  ]);

  return {
    distribution,
    last24h,
    swingCount: Number(swingRows[0]?.swing) || 0,
    windowStartIso,
  };
}
