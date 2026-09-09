/**
 * Weekly public moves (issue #2175 do-step 4; built to be reused by #2147 so
 * the two lanes never duplicate the query or the line format).
 *
 * The quiet-week brief shows ONE real public-cohort move — "Elsewhere this
 * week: {brand} changed {field} on {date}" — instead of a bare "all quiet".
 * A public move is the newest offer-timeline transition in the stored public
 * corpus (`landing_page_snapshot`, written by monitoring #952) inside the
 * trailing 7-day window.
 *
 * Honesty contract:
 * - bounded reads only; no live scraping, no provider calls;
 * - every candidate domain is re-verified through `loadOfferTimeline`, the
 *   exact gate chain the public `/timeline/:domain` page renders with
 *   (complete-proof gate #1284, ad-destination exclusion #1729, canonical
 *   URL ownership) — a move that page cannot render is never emailed;
 * - no watchlist rows are read, so the line never leaks what the recipient
 *   tracks;
 * - missing D1 / missing table / empty corpus degrades to `[]` (the quiet
 *   brief then renders its classic all-quiet body unchanged).
 */

import { normalizeBrandPageDomain } from "~/lib/brand-page.server";
import { queryAll } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import { loadOfferTimeline } from "~/lib/offer-timeline.server";
import type { OfferLedgerEntry } from "~/lib/offer-timeline";
import { canonicalizeSitemapTimelineDomain } from "~/lib/sitemap-timeline-cohort";

export interface WeeklyPublicMove {
  /** Registrable domain, e.g. "nike.com". */
  domain: string;
  /** Public display name for the line's {brand} slot. */
  brandName: string;
  /** Customer-words field label for the line's {field} slot, e.g. "its offer". */
  fieldLabel: string;
  /** ISO capture time of the newer state — the move's date. */
  changedAt: string;
  /** Public path proving the move, e.g. "/timeline/nike.com". */
  path: string;
}

const PUBLIC_MOVE_WINDOW_DAYS = 7;
/** Newest corpus rows scanned for candidate domains (bounded, newest first). */
const PUBLIC_MOVE_CANDIDATE_ROW_LIMIT = 60;
/** Candidate domains re-verified through the public page's own gate chain. */
const PUBLIC_MOVE_CANDIDATE_DOMAIN_LIMIT = 5;

interface RecentSnapshotRow {
  canonical_url: string;
  captured_at: string;
}

export async function loadWeeklyPublicMoves(
  env: AppEnv,
  options: { now?: Date; limit?: number } = {},
): Promise<WeeklyPublicMove[]> {
  if (!env?.DB) {
    return [];
  }
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 10);
  const windowStart = new Date(
    now.getTime() - PUBLIC_MOVE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  let rows: RecentSnapshotRow[];
  try {
    rows = await queryAll<RecentSnapshotRow>(
      env,
      `
        SELECT canonical_url, captured_at
        FROM landing_page_snapshot
        WHERE captured_at >= ?
        ORDER BY captured_at DESC, id DESC
        LIMIT ?
      `,
      windowStart,
      PUBLIC_MOVE_CANDIDATE_ROW_LIMIT,
    );
  } catch (error) {
    if (isMissingSnapshotTable(error)) {
      return [];
    }
    throw error;
  }

  // Newest-first candidate domains, deduped. Domain extraction is the shared
  // sitemap canonicalizer so the cohort vocabulary never drifts.
  const candidateDomains: string[] = [];
  for (const row of rows) {
    const domain = domainFromCanonicalUrl(row.canonical_url);
    if (domain && !candidateDomains.includes(domain)) {
      candidateDomains.push(domain);
      if (candidateDomains.length >= PUBLIC_MOVE_CANDIDATE_DOMAIN_LIMIT) {
        break;
      }
    }
  }

  const moves: WeeklyPublicMove[] = [];
  for (const domain of candidateDomains) {
    const move = await newestPublicMoveForDomain(env, domain, windowStart);
    if (move) {
      moves.push(move);
      if (moves.length >= limit) {
        break;
      }
    }
  }
  return moves;
}

/**
 * The domain's newest in-window ledger entry that is a real transition
 * (suppressed pairs carry `transition: null` by the #1996 gate, so they can
 * never pose as moves here). Returns null when the public page would render
 * no such move.
 */
async function newestPublicMoveForDomain(
  env: AppEnv,
  domain: string,
  windowStart: string,
): Promise<WeeklyPublicMove | null> {
  let entries: OfferLedgerEntry[];
  try {
    entries = (await loadOfferTimeline(env, { domain, asOf: null })).entries;
  } catch {
    return null;
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry.transition || entry.capturedAt < windowStart) {
      continue;
    }
    const fieldLabel = transitionFieldLabel(entry);
    if (!fieldLabel) {
      continue;
    }
    const brand = normalizeBrandPageDomain(domain);
    return {
      domain,
      brandName: brand?.displayName ?? domain,
      fieldLabel,
      changedAt: entry.capturedAt,
      path: `/timeline/${domain}`,
    };
  }
  return null;
}

/** The money fact first: offer > CTA > headline > form. */
function transitionFieldLabel(entry: OfferLedgerEntry): string | null {
  const transition = entry.transition;
  if (!transition) {
    return null;
  }
  if (transition.priceText) return "its offer";
  if (transition.ctaText) return "its call to action";
  if (transition.headline) return "its headline";
  if (transition.formPresent) return "its form";
  return null;
}

function domainFromCanonicalUrl(canonicalUrl: string): string | null {
  try {
    return canonicalizeSitemapTimelineDomain(new URL(canonicalUrl).hostname);
  } catch {
    return null;
  }
}

function isMissingSnapshotTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.toLowerCase().includes("no such table") &&
    message.includes("landing_page_snapshot")
  );
}
