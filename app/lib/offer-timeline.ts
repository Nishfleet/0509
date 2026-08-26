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

export function parseSinceInstant(value: string | null | undefined): string | null {
  const asOf = parseAsOfDate(value);
  if (asOf) {
    return `${asOf}T00:00:00.000Z`;
  }
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

type OfferDiffFields = Pick<OfferSnapshotInput, "headline" | "ctaText" | "priceText" | "formPresent">;

export function diffOfferStates(before: OfferDiffFields, after: OfferDiffFields): OfferTransition {
  return diffOffer(before, after);
}

function diffOffer(before: OfferDiffFields, after: OfferDiffFields): OfferTransition {
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
