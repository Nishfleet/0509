/**
 * Public Offer Timeline — pure ledger math.
 *
 * Dated offer states come from stored `landing_page_snapshot` rows. This
 * module never touches D1 or R2: it turns already-loaded snapshots into a
 * vertical ledger with before/after on each transition, screenshot/page-text
 * hrefs, and "as of <date>" retrieval.
 */

import { SUPPORTED_COUNTRIES } from "~/lib/countries";
import { proofScreenshotSrc } from "~/lib/proof-screenshot";
import { proofPageTextSrc } from "~/lib/proof-page-text";

const AS_OF_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const OFFER_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export interface OfferSnapshotInput {
  id: string;
  canonicalUrl: string;
  capturedAt: string;
  headline: string;
  ctaText: string | null;
  priceText: string | null;
  formPresent: boolean | null;
  screenshotKey: string | null;
  pageTextKey: string | null;
  /**
   * The market the captured page declared for itself (issue #2889,
   * e.g. `"GB"` vs `"US"`), from Shopify.country / countryCode in the
   * raw render. Null when the snapshot's metadata predates the signal
   * (pre-lp-signals-v8) or the page declared nothing — the capture-validity
   * gate never suppresses on an unknown market.
   */
  declaredMarketCountry?: string | null;
  /**
   * How this snapshot was captured (e.g. `landing_page_fetch`, `demo_backfill`,
   * `sitemap_brand_seed`). Null when the row does not carry a capture method.
   */
  captureMethod?: string | null;
  /**
   * Honest evidence label shown when a snapshot has no screenshot and no
   * page-text link (e.g. a seeded backfill row). Null when the snapshot
   * carries real artifact receipts. The data layer sets this from stored
   * metadata; the pure ledger only passes it through.
   */
  evidenceNote: string | null;
}

export interface OfferFieldChange<T> {
  before: T;
  after: T;
}

export interface OfferTransition {
  headline: OfferFieldChange<string> | null;
  ctaText: OfferFieldChange<string | null> | null;
  priceText: OfferFieldChange<string | null> | null;
  formPresent: OfferFieldChange<boolean | null> | null;
}

export interface OfferLedgerEntry {
  id: string;
  capturedAt: string;
  dateLabel: string;
  canonicalUrl: string;
  headline: string;
  ctaText: string | null;
  priceText: string | null;
  formPresent: boolean | null;
  screenshotHref: string | null;
  pageTextHref: string | null;
  /**
   * How this snapshot was captured (e.g. `landing_page_fetch`, `demo_backfill`,
   * `sitemap_brand_seed`). Null when the row does not carry a capture method.
   */
  captureMethod?: string | null;
  /** The page-declared market carried through from the snapshot (issue #2889). */
  declaredMarketCountry?: string | null;
  /**
   * Honest evidence label shown when a snapshot has no screenshot and no
   * page-text link (e.g. a seeded backfill row). Null when real artifact
   * receipts are present.
   */
  evidenceNote: string | null;
  /** Null on the first dated state — there is no prior offer to diff. */
  transition: OfferTransition | null;
  /**
   * Why this capture was suppressed instead of emitted as a real offer
   * transition (issue #1996). Non-null means the snapshot pair was held back
   * because it differs only by geo locale or matches a cookie-banner/consent
   * string — `transition` is forced null and no phantom offer change is
   * reported. Null is the normal state (a genuine change or the first dated
   * state).
   */
  suppressedReason?: string | null;
  /**
   * The run's extent when consecutive captures were identical (issue #1957).
   * Non-null on a collapsed dated state: the snapshot stayed unchanged
   * through a later capture, so the state is shown once with an honest
   * "unchanged since <date>" note instead of repeated identical rows.
   * Null on a normal singleton state that changed, or on the first dated
   * state.
   */
  runExtentLabel: string | null;
}

export function parseAsOfDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.trim().match(AS_OF_PATTERN);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function asOfEndUtc(asOf: string): string {
  return `${asOf}T23:59:59.999Z`;
}

/**
 * Honest evidence label for a snapshot that carries no screenshot and no
 * page-text link — the backfill case (issue #968). The label names the real
 * capture date so a reader can tell a seeded state from a real monitoring
 * capture that would link a screenshot. Never fabricated: it states the
 * absence of a screenshot plainly.
 */
export function backfillEvidenceNote(capturedAt: string): string {
  return `Captured on ${formatOfferDate(capturedAt)}, no screenshot`;
}

export function formatOfferDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return OFFER_DATE_FORMATTER.format(date);
}

const COUNTRY_ISO_CODES = new Set(
  SUPPORTED_COUNTRIES.map((country) => country.code.toLowerCase()),
);

/**
 * Detect a geo locale encoded as the first path segment of a canonical URL
 * (issue #1996). Returns the lowercase ISO-2 code when the segment matches a
 * `SUPPORTED_COUNTRIES` code (e.g. `/sg/` -> `"sg"`, `/fr/` -> `"fr"`), else
 * null. Non-locale path segments (product slugs, brand seed handles) are not
 * treated as locales, so a genuine `/fr/`-vs-`/sg/` product-page swap is not
 * wrongly suppressed.
 */
export function geoLocaleSegment(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const cleaned = path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  const firstSegment = (cleaned.split("/")[0] ?? "").toLowerCase();
  return COUNTRY_ISO_CODES.has(firstSegment) ? firstSegment : null;
}

const COOKIE_BANNER_OR_CONSENT_PATTERNS = [
  // French/English ads-personalization and consent-banner phrases. Kept at
  // phrase level (not bare "cookie"/"consent"/"personalised") so ordinary
  // offer copy like a "Personalised winter sale" headline is never suppressed.
  // Generic offer CTA verbs ("Shop Now") are intentionally absent.
  "publicités personnalisées",
  "personalised ads",
  "personalised advertising",
  "personalised content",
  "personalized ads",
  "personalized advertising",
  "personalized content",
  "ad personalisation",
  "ad personalization",
  "personal preferences",
  "cookie settings",
  "cookie preferences",
  "cookie banner",
  "cookie consent",
  "manage cookies",
  "accept cookies",
  "reject cookies",
  "accept all cookies",
  "reject all cookies",
  "gérer mes cookies",
  "gestion des cookies",
  "consent settings",
  "consent preferences",
  "privacy consent",
  "privacy settings",
  "privacy preferences",
  "ad preferences",
  "accept all",
  "reject all",
];

/**
 * True when the text matches a known cookie-banner or ads-personalization
 * consent string (issue #1996). Case-insensitive substring match. Kept to
 * consent/ads-personalization strings only — generic offer CTA verbs (e.g.
 * "Shop Now") are intentionally NOT here so remaining generic CTAs still diff
 * normally.
 */
export function isCookieBannerOrConsent(text: string | null): boolean {
  if (!text) {
    return false;
  }
  const lower = text.toLowerCase();
  return COOKIE_BANNER_OR_CONSENT_PATTERNS.some((needle) => lower.includes(needle));
}

interface CaptureValiditySnapshot {
  canonicalUrl: string;
  headline: string;
  ctaText: string | null;
  declaredMarketCountry?: string | null;
}

/**
 * Decide whether a snapshot pair should be suppressed instead of emitted as a
 * real offer transition (issue #1996).
 *
 * Returns the reason to suppress, or null to diff normally:
 * - `"geo locale change"` when both canonical URLs carry a geo locale path
 *   segment and those locales differ (e.g. `/sg/` vs `/fr/`).
 * - `"geo market change"` when both snapshots declare a page market
 *   (Shopify.country / countryCode, issue #2889) and those markets differ —
 *   the same-URL render-variant case: the allbirds captures alternated
 *   "Shop Now" / "Sign Up" between GB-declared and US-declared renders of
 *   the same canonical URL. When either side declares nothing, no
 *   suppression — an unknown market can never hide a real change.
 * - `"cookie banner / consent string"` when the current CTA or headline
 *   matches a known consent/ads-personalization string.
 * - null otherwise (a genuine same-geo change diffs normally).
 */
export function captureValidityReason(
  previous: CaptureValiditySnapshot,
  current: CaptureValiditySnapshot,
): string | null {
  const previousLocale = geoLocaleSegment(previous.canonicalUrl);
  const currentLocale = geoLocaleSegment(current.canonicalUrl);
  if (
    previousLocale !== null &&
    currentLocale !== null &&
    previousLocale !== currentLocale
  ) {
    return "geo locale change";
  }
  const previousMarket = previous.declaredMarketCountry ?? null;
  const currentMarket = current.declaredMarketCountry ?? null;
  if (
    previousMarket !== null &&
    currentMarket !== null &&
    previousMarket !== currentMarket
  ) {
    return "geo market change";
  }
  if (
    isCookieBannerOrConsent(current.ctaText) ||
    isCookieBannerOrConsent(current.headline)
  ) {
    return "cookie banner / consent string";
  }
  return null;
}

export function canonicalUrlBelongsToDomain(canonicalUrl: string, domain: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(canonicalUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const needle = domain.toLowerCase();
  return hostname === needle || hostname === `www.${needle}` || hostname.endsWith(`.${needle}`);
}

function offerFieldsEqual(left: OfferSnapshotInput, right: OfferSnapshotInput): boolean {
  return (
    left.headline === right.headline &&
    left.ctaText === right.ctaText &&
    left.priceText === right.priceText &&
    left.formPresent === right.formPresent
  );
}

/**
 * The last emitted dated state that was NOT itself suppressed (issue #1996,
 * phase 6). A suppressed state carries `transition: null` and a non-null
 * `suppressedReason` — it is a capture-validity artefact (geo locale change
 * or cookie-banner/consent string), not a real offer state. Later snapshots
 * must diff against a real state, never a suppressed one, else a later
 * same-region capture could "restore" a price/CTA that only ever existed as
 * a suppressed placeholder (e.g. the French "—" price) and emit a phantom
 * transition. Suppressed states are still emitted as their own labeled dated
 * states — only the BASELINE for later transitions skips them.
 */
function lastNonSuppressedEntry(
  entries: readonly OfferLedgerEntry[],
): OfferLedgerEntry | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.suppressedReason == null) {
      return entry;
    }
  }
  return undefined;
}

/**
 * Build the dated offer-state ledger (issue #1957).
 *
 * Consecutive captures that are identical in all four commercial fields
 * (headline, CTA, price, form present) collapse into ONE dated state so that
 * capture-retry bursts do not render as many distinct "dated offer states"
 * with empty transitions. The collapsed entry keeps the run's first capture's
 * date and artifact hrefs, and carries a `runExtentLabel` (e.g. "unchanged
 * since 2 Sept 2026") so a genuinely persistent offer stays visible as a run
 * rather than as repeated identical rows. A real field change between runs
 * still produces a before/after transition.
 */
export function buildOfferLedger(snapshots: readonly OfferSnapshotInput[]): OfferLedgerEntry[] {
  const ordered = [...snapshots].sort((left, right) => {
    const byTime = left.capturedAt.localeCompare(right.capturedAt);
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });

  const entries: OfferLedgerEntry[] = [];
  let runStart = 0;

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    const next = index + 1 < ordered.length ? ordered[index + 1] : undefined;
    const runContinues = next !== undefined && offerFieldsEqual(current, next);
    if (runContinues) {
      continue;
    }

    // `current` is the last snapshot of a maximal identical run in
    // [runStart..index]. Emit ONE collapsed state for the whole run.
    const firstInRun = ordered[runStart]!;
    const runLength = index - runStart + 1;
    // Phase 6: the diff/gate baseline is the last NON-suppressed emitted entry,
    // never the raw last one. The raw last entry may itself be a suppressed
    // state (transition null, suppressedReason set) whose placeholder fields
    // (e.g. a "—" price or a consent CTA) are not a real offer state — diffing
    // a later real capture against it would fabricate a phantom "price restored
    // from —" transition. Scanning from the end for the first non-suppressed
    // entry closes that back-door, while suppressed states remain emitted as
    // their own labeled dated states.
    const previousState = lastNonSuppressedEntry(entries);
    // Capture-validity gate (issue #1996): hold back snapshot pairs that differ
    // only by geo locale or whose CTA/headline matches a cookie-banner/consent
    // string. When a reason is found, emit the state as suppressed — transition
    // forced null, reason recorded — instead of a phantom offer transition. The
    // first dated state (no previous) always keeps transition null +
    // suppressedReason null.
    const suppressedReason = previousState
      ? captureValidityReason(previousState, firstInRun)
      : null;

    entries.push({
      id: firstInRun.id,
      capturedAt: firstInRun.capturedAt,
      dateLabel: formatOfferDate(firstInRun.capturedAt),
      canonicalUrl: firstInRun.canonicalUrl,
      headline: firstInRun.headline,
      ctaText: firstInRun.ctaText,
      priceText: firstInRun.priceText,
      formPresent: firstInRun.formPresent,
      screenshotHref: proofScreenshotSrc(firstInRun.screenshotKey),
      pageTextHref: proofPageTextSrc(firstInRun.pageTextKey),
      captureMethod: firstInRun.captureMethod ?? null,
      declaredMarketCountry: firstInRun.declaredMarketCountry ?? null,
      evidenceNote: firstInRun.evidenceNote ?? null,
      transition: previousState && suppressedReason === null
        ? diffOfferBetweenStates(previousState, firstInRun)
        : null,
      suppressedReason,
      runExtentLabel:
        runLength > 1 ? `unchanged since ${formatOfferDate(current.capturedAt)}` : null,
    });

    runStart = index + 1;
  }

  return entries;
}

/**
 * Is this price text a currency-zero placeholder — a `0.00`/`0,00` value
 * wrapped in a currency marker (e.g. `$0.00`, `£0.00`, `€0,00`, `0.00 $`)?
 * A broken regional extraction, not a real offer (issue #3128): no real
 * product costs 0 units of the currency a real page charges in.
 */
export function isPlaceholderOfferPrice(priceText: string): boolean {
  const trimmed = priceText.trim().toLowerCase();
  if (!trimmed) return false;
  // Zero with a decimal separator, optionally wrapped in currency symbols
  // or 1-4 letter currency codes on either side.
  return /^[$€£¥]?\s*(?:[a-z]{1,4}\s*)?0(?:[.,]\d{1,4})+\s*(?:[a-z]{1,4}\s*)?[$€£¥]?$/.test(trimmed);
}

/**
 * Diff the commercial fields of a previously emitted dated state against the
 * first snapshot of the next distinct run. Both arguments are uniform within
 * their own run, so comparing their representatives yields the real transition.
 *
 * Move-validity gate (issue #3128): a price transition whose BEFORE or AFTER
 * is a currency-zero placeholder is not rendered as a move. This is the
 * shared rendering path for both /timeline/:domain and /briefs/weekly, so a
 * "$0.00 → £0.00" row can never surface on either public surface. Placeholder
 * values also never act as the "after" half of a published move — the next
 * real capture keeps diffing until a real (non-placeholder) state.
 */
function diffOfferBetweenStates(
  previous: OfferLedgerEntry,
  firstInRun: OfferSnapshotInput,
): OfferTransition {
  const priceChange = changeIfDifferent(previous.priceText, firstInRun.priceText);
  return {
    headline: changeIfDifferent(previous.headline, firstInRun.headline),
    ctaText: changeIfDifferent(previous.ctaText, firstInRun.ctaText),
    priceText:
      priceChange &&
      priceChange.before !== null &&
      priceChange.after !== null &&
      !isPlaceholderOfferPrice(priceChange.before) &&
      !isPlaceholderOfferPrice(priceChange.after)
        ? priceChange
        : null,
    formPresent: changeIfDifferent(previous.formPresent, firstInRun.formPresent),
  };
}

export function offerStateAsOf(
  ledger: readonly OfferLedgerEntry[],
  asOf: string,
): OfferLedgerEntry | null {
  const cutoff = asOfEndUtc(asOf);
  let match: OfferLedgerEntry | null = null;
  for (const entry of ledger) {
    if (entry.capturedAt <= cutoff) {
      match = entry;
    } else {
      break;
    }
  }
  return match;
}

function changeIfDifferent<T>(before: T, after: T): OfferFieldChange<T> | null {
  if (Object.is(before, after)) {
    return null;
  }
  return { before, after };
}
