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

export function buildOfferLedger(snapshots: readonly OfferSnapshotInput[]): OfferLedgerEntry[] {
  const ordered = [...snapshots].sort((left, right) => {
    const byTime = left.capturedAt.localeCompare(right.capturedAt);
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });

  return ordered.map((snapshot, index) => {
    const previous = index > 0 ? ordered[index - 1] : undefined;
    return {
      id: snapshot.id,
      capturedAt: snapshot.capturedAt,
      dateLabel: formatOfferDate(snapshot.capturedAt),
      canonicalUrl: snapshot.canonicalUrl,
      headline: snapshot.headline,
      ctaText: snapshot.ctaText,
      priceText: snapshot.priceText,
      formPresent: snapshot.formPresent,
      screenshotHref: proofScreenshotSrc(snapshot.screenshotKey),
      pageTextHref: proofPageTextSrc(snapshot.pageTextKey),
      captureMethod: snapshot.captureMethod ?? null,
      evidenceNote: snapshot.evidenceNote ?? null,
      transition: previous ? diffOffer(previous, snapshot) : null,
    };
  });
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

function diffOffer(before: OfferSnapshotInput, after: OfferSnapshotInput): OfferTransition {
  return {
    headline: changeIfDifferent(before.headline, after.headline),
    ctaText: changeIfDifferent(before.ctaText, after.ctaText),
    priceText: changeIfDifferent(before.priceText, after.priceText),
    formPresent: changeIfDifferent(before.formPresent, after.formPresent),
  };
}

function changeIfDifferent<T>(before: T, after: T): OfferFieldChange<T> | null {
  if (Object.is(before, after)) {
    return null;
  }
  return { before, after };
}
