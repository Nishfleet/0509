/**
 * Public Offer Timeline — pure ledger math.
 *
 * Dated offer states come from stored `landing_page_snapshot` rows. This
 * module never touches D1 or R2: it turns already-loaded snapshots into a
 * vertical ledger with before/after on each transition, screenshot/page-text
 * hrefs, and "as of <date>" retrieval.
 */

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
  /**
   * Honest evidence label shown when a snapshot has no screenshot and no
   * page-text link (e.g. a seeded backfill row). Null when real artifact
   * receipts are present.
   */
  evidenceNote: string | null;
  /** Null on the first dated state — there is no prior offer to diff. */
  transition: OfferTransition | null;
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
    const previousState = entries.length > 0 ? entries[entries.length - 1] : undefined;

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
      evidenceNote: firstInRun.evidenceNote ?? null,
      transition: previousState
        ? diffOfferBetweenStates(previousState, firstInRun)
        : null,
      runExtentLabel:
        runLength > 1 ? `unchanged since ${formatOfferDate(current.capturedAt)}` : null,
    });

    runStart = index + 1;
  }

  return entries;
}

/**
 * Diff the commercial fields of a previously emitted dated state against the
 * first snapshot of the next distinct run. Both arguments are uniform within
 * their own run, so comparing their representatives yields the real transition.
 */
function diffOfferBetweenStates(
  previous: OfferLedgerEntry,
  firstInRun: OfferSnapshotInput,
): OfferTransition {
  return {
    headline: changeIfDifferent(previous.headline, firstInRun.headline),
    ctaText: changeIfDifferent(previous.ctaText, firstInRun.ctaText),
    priceText: changeIfDifferent(previous.priceText, firstInRun.priceText),
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
