/**
 * Weekly public moves — the data layer behind `/briefs/weekly` and the
 * `scripts/weekly-offer-moves-report.mjs` data post (issue #2143).
 *
 * The page publishes "what moved this week" across the brands that ALREADY
 * have a public, sitemap-indexable page. Every input is a stored row; this
 * module never triggers live scraping, Browser Rendering, or any paid
 * operation.
 *
 * Honesty gates (the same ones /ads/:domain and /timeline/:domain render
 * under, reused — not re-implemented):
 *
 *   1. Domain gate: a move is published only when its domain is in the
 *      sitemap's indexable set — `loadIndexableBrandPageEntries` (the exact
 *      mirror of the /ads/:domain loader's indexability rules: public_search
 *      context, resolved non-demo provider, non-demo payload, ads present,
 *      7-day freshness, >=1 verified-linked ad, no aliases, lookup parity)
 *      or `loadIndexableTimelineEntries` (the /timeline/:domain mirror:
 *      proof-complete, not ad-destination, lossless domain recovery). A
 *      customer-private or otherwise non-indexable domain can never appear —
 *      its watch events and snapshots are dropped here even when they exist.
 *   2. Event gate: only `status = 'confirmed'` watch events qualify (the
 *      proof-backed set); suppressed/invalidated/detected rows and the
 *      honest `baseline` bookkeeping event are not "moves" and never render.
 *   3. Snapshot gate: landing-snapshot moves come from `loadOfferTimeline`,
 *      so the proof gate (screenshot + page text), the ad-destination gate,
 *      and the capture-validity suppression (geo-locale / consent-banner
 *      phantoms) all apply exactly as on the public timeline.
 *   4. PII by construction: the SQL selects only event type, system-generated
 *      title, event metadata, and the watchlist target URL — never the
 *      watchlist name, user id, or any customer-supplied string. The brand
 *      label is derived from the public domain (`displayNameFromDomain`),
 *      never from customer input.
 *
 * Reads are bounded (one capped SELECT per source plus one bounded ledger
 * read per candidate domain, capped at WEEKLY_MOVES_DOMAIN_LIMIT) and every
 * phase degrades to an empty list on a missing table / D1 hiccup, so the
 * route renders its honest quiet state instead of a 500.
 */

import { displayNameFromDomain } from "~/lib/ads-internal-links";
import { normalizeBrandPageDomain } from "~/lib/brand-page.server";
import { queryAll } from "~/lib/data/d1.server";
import { parseJson } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import {
  isPlaceholderOfferPrice,
  loadOfferTimeline,
  type OfferTimelineLoad,
} from "~/lib/offer-timeline.server";
import { registrableDomainFromHostname } from "~/lib/search-query";
import {
  loadIndexableBrandPageEntries,
  loadIndexableTimelineEntries,
  timelineDomainFromSnapshotRow,
  type TimelineSitemapRow,
} from "~/lib/sitemap.server";

/** The rolling window the weekly brief covers. */
export const WEEKLY_MOVES_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Hard bound on the watch_event read (newest-first). */
export const WEEKLY_MOVES_EVENT_READ_LIMIT = 500;
/** Hard bound on the recent landing-snapshot read (newest-first). */
export const WEEKLY_MOVES_SNAPSHOT_READ_LIMIT = 1000;
/**
 * Hard bound on per-domain offer-ledger reads. Only indexable domains with a
 * snapshot captured inside the window consume a ledger read, so this stays
 * small in practice; the cap keeps a seeded-cohort growth spurt bounded.
 */
export const WEEKLY_MOVES_DOMAIN_LIMIT = 40;
/** Hard bound on published moves per render. */
export const WEEKLY_MOVES_LIMIT = 100;

/**
 * The field vocabulary shared by the route, the report script, and the test
 * fixture. The script (`scripts/weekly-offer-moves-report.mjs`) cannot import
 * TS, so it matches these literal strings — keep the two in sync.
 */
export const WEEKLY_MOVE_FIELD = {
  newAds: "New ads",
  destinationUrl: "Destination URL",
  headline: "Headline",
  offerPrice: "Offer / price",
  cta: "CTA",
  leadForm: "Lead form",
} as const;

export type WeeklyPublicMoveField =
  (typeof WEEKLY_MOVE_FIELD)[keyof typeof WEEKLY_MOVE_FIELD];

export interface WeeklyPublicMove {
  /** Public brand label derived from the domain — never customer input. */
  brand: string;
  /** Registrable domain the move belongs to (lowercased, no www). */
  domain: string;
  /** What changed, from WEEKLY_MOVE_FIELD. */
  field: WeeklyPublicMoveField;
  /** Before text from the stored row, or null when there is no prior value. */
  beforeText: string | null;
  /** After text from the stored row, or null when there is no new value. */
  afterText: string | null;
  /** Public source link a reader can open (the brand's own page). */
  sourceUrl: string | null;
  /** ISO capture timestamp of the stored row. */
  capturedAt: string;
  /** `/ads/:domain` when that brand page is sitemap-indexable, else null. */
  adsPath: string | null;
  /** `/timeline/:domain` when that timeline is sitemap-indexable, else null. */
  timelinePath: string | null;
}

/** Subset of watch_event/watchlist columns the weekly read selects. */
interface WeeklyWatchEventRow {
  event_type: string;
  title: string;
  metadata_json: string;
  created_at: string;
  target_id: string;
}

const EVENT_TYPE_TO_FIELD: Record<string, WeeklyPublicMoveField> = {
  ad_new: WEEKLY_MOVE_FIELD.newAds,
  landing_page_url_changed: WEEKLY_MOVE_FIELD.destinationUrl,
  landing_page_headline_changed: WEEKLY_MOVE_FIELD.headline,
  landing_page_offer_changed: WEEKLY_MOVE_FIELD.offerPrice,
  landing_page_cta_changed: WEEKLY_MOVE_FIELD.cta,
  landing_page_form_changed: WEEKLY_MOVE_FIELD.leadForm,
};

/**
 * Recover the registrable brand domain an advertiser watchlist targets, or
 * null. `target_id` is the normalized competitor URL written at watchlist
 * creation (`https://host[/path]`); a bare host is tolerated for legacy rows.
 * The candidate passes through the same `normalizeBrandPageDomain` the
 * /ads/:domain route applies, so a domain the route would 404 on is never
 * published.
 */
export function domainFromWatchlistTargetId(targetId: string): string | null {
  const raw = targetId.trim();
  if (!raw) {
    return null;
  }
  let hostname: string;
  try {
    hostname = new URL(raw).hostname;
  } catch {
    try {
      hostname = new URL(`https://${raw}`).hostname;
    } catch {
      return null;
    }
  }
  const registrable = registrableDomainFromHostname(
    hostname.trim().toLowerCase().replace(/\.$/, ""),
  );
  if (!registrable) {
    return null;
  }
  return normalizeBrandPageDomain(registrable)?.domain ?? null;
}

function readMetadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/** A stored ISO timestamp wins; the row's created_at is the honest fallback. */
function moveCapturedAt(
  metadata: Record<string, unknown>,
  createdAt: string,
): string {
  const capturedAt = readMetadataString(metadata, "capturedAt");
  if (capturedAt && Number.isFinite(Date.parse(capturedAt))) {
    return capturedAt;
  }
  return createdAt;
}

/**
 * The public source link for a watch event: the new destination URL when the
 * event carries one (landing_page_url_changed), else the brand's own origin.
 * Never a customer-supplied label.
 */
function watchEventSourceUrl(
  metadata: Record<string, unknown>,
  domain: string,
): string {
  const to = readMetadataString(metadata, "to");
  if (to && /^https?:\/\//.test(to)) {
    return to;
  }
  return `https://${domain}`;
}

/**
 * Map one confirmed watch_event row to a public move, or null when the event
 * is not a publishable move (baseline bookkeeping, unknown type, empty diff).
 */
export function watchEventRowToPublicMove(
  row: WeeklyWatchEventRow,
  domain: string,
  links: { adsPath: string | null; timelinePath: string | null },
): WeeklyPublicMove | null {
  const field = EVENT_TYPE_TO_FIELD[row.event_type];
  if (!field) {
    return null;
  }
  const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
  // The first-scan baseline ("we recorded N ads as your starting point") is
  // honest bookkeeping, not a competitor move — never publish it as one.
  if (metadata.kind === "baseline") {
    return null;
  }
  const beforeText = readMetadataString(metadata, "from");
  let afterText = readMetadataString(metadata, "to");
  if (field === WEEKLY_MOVE_FIELD.newAds) {
    // ad_new rows carry no from/to; the system-generated title states the
    // count ("5 new ads launched" / "New ad detected").
    afterText = afterText ?? row.title;
  }
  if (field !== WEEKLY_MOVE_FIELD.newAds && !beforeText && !afterText) {
    return null;
  }
  const move = {
    brand: displayNameFromDomain(domain),
    domain,
    field,
    beforeText,
    afterText,
    sourceUrl: watchEventSourceUrl(metadata, domain),
    capturedAt: moveCapturedAt(metadata, row.created_at),
    adsPath: links.adsPath,
    timelinePath: links.timelinePath,
  };
  return isPublishableWeeklyMove(move) ? move : null;
}

/**
 * Move-validity gate for the public brief (issue #3128). A row renders as a
 * move only when BOTH values are real:
 *   - either side matching a currency-zero placeholder (`$0.00 → £0.00`)
 *     disqualifies the move;
 *   - a single-value row (one side null — a baseline capture) is not a move
 *     and is excluded, never dressed up as a change.
 * The regression test in `tests/brief-move-validity.test.ts` pins this: a
 * placeholder row, a baseline row and a real offer change yield exactly one
 * move row.
 */
export function isPublishableWeeklyMove(
  move: Pick<WeeklyPublicMove, "field" | "beforeText" | "afterText">,
): boolean {
  if (move.field === WEEKLY_MOVE_FIELD.newAds) {
    // ad_new rows legitimately have no before side.
    return (move.afterText ?? "").trim().length > 0;
  }
  // A true prior capture must exist: both sides present (pre-change value
  // and new value), neither a placeholder, neither identical.
  if (!move.beforeText || !move.afterText) {
    return false;
  }
  if (move.beforeText.trim() === move.afterText.trim()) {
    return false;
  }
  return !isPlaceholderOfferPrice(move.beforeText) && !isPlaceholderOfferPrice(move.afterText);
}

/**
 * Map one offer-ledger entry (already proof-gated and validity-gated by
 * loadOfferTimeline) to one public move per changed field. Entries without a
 * transition (the first dated state) or with a suppression reason (geo-locale
 * / consent-banner phantoms) yield nothing — the timeline does not show them
 * as changes, so the brief does not either.
 */
export function offerLedgerEntryToPublicMoves(
  entry: OfferTimelineLoad["entries"][number],
  domain: string,
  links: { adsPath: string | null; timelinePath: string | null },
): WeeklyPublicMove[] {
  if (!entry.transition || entry.suppressedReason) {
    return [];
  }
  const brand = displayNameFromDomain(domain);
  const moves: WeeklyPublicMove[] = [];
  const push = (
    field: WeeklyPublicMoveField,
    beforeText: string | null,
    afterText: string | null,
  ) => {
    moves.push({
      brand,
      domain,
      field,
      beforeText,
      afterText,
      sourceUrl: entry.canonicalUrl,
      capturedAt: entry.capturedAt,
      adsPath: links.adsPath,
      timelinePath: links.timelinePath,
    });
  };
  const { headline, priceText, ctaText, formPresent } = entry.transition;
  if (headline) {
    push(WEEKLY_MOVE_FIELD.headline, headline.before, headline.after);
  }
  if (priceText) {
    push(WEEKLY_MOVE_FIELD.offerPrice, priceText.before, priceText.after);
  }
  if (ctaText) {
    push(WEEKLY_MOVE_FIELD.cta, ctaText.before, ctaText.after);
  }
  if (formPresent) {
    const label = (value: boolean | null) =>
      value === null ? null : value ? "Form present" : "No form";
    push(WEEKLY_MOVE_FIELD.leadForm, label(formPresent.before), label(formPresent.after));
  }
  return moves;
}

function isMissingTableError(error: unknown, table: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("no such table") && message.includes(table);
}

interface IndexableDomainSets {
  /** Domains whose /ads/:domain page the sitemap lists. */
  adsDomains: Set<string>;
  /** Domains whose /timeline/:domain the sitemap lists. */
  timelineDomains: Set<string>;
  /** Union — the domains any weekly move may name. */
  allowed: Set<string>;
}

/**
 * The sitemap-indexable domain sets, loaded through the exact helpers the
 * sitemap uses (issue #2143 step 1: "reuse the sitemap gate helpers"). Both
 * loaders are bounded cache reads that never trigger live discovery; both
 * degrade to empty on a hiccup, which degrades the brief to its quiet state.
 */
async function loadIndexableDomainSets(env: AppEnv): Promise<IndexableDomainSets> {
  const empty: IndexableDomainSets = {
    adsDomains: new Set(),
    timelineDomains: new Set(),
    allowed: new Set(),
  };
  if (!env.DB) {
    return empty;
  }
  try {
    const [brandEntries, timelineEntries] = await Promise.all([
      loadIndexableBrandPageEntries(env),
      loadIndexableTimelineEntries(env),
    ]);
    const adsDomains = new Set(
      brandEntries.map((entry) => entry.path.slice("/ads/".length)),
    );
    const timelineDomains = new Set(
      timelineEntries.map((entry) => entry.path.slice("/timeline/".length)),
    );
    return {
      adsDomains,
      timelineDomains,
      allowed: new Set([...adsDomains, ...timelineDomains]),
    };
  } catch (error) {
    console.warn("Weekly public moves: indexable-domain load failed; quiet state.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return empty;
  }
}

function linksForDomain(
  domain: string,
  sets: IndexableDomainSets,
): { adsPath: string | null; timelinePath: string | null } {
  // Link only the pages the sitemap itself lists — a noindex /ads shell or a
  // 410 timeline is never linked from the brief (the same rule the /brands
  // hub follows).
  return {
    adsPath: sets.adsDomains.has(domain) ? `/ads/${domain}` : null,
    timelinePath: sets.timelineDomains.has(domain)
      ? `/timeline/${domain}`
      : null,
  };
}

async function loadWatchEventMoves(
  env: AppEnv,
  since: string,
  sets: IndexableDomainSets,
): Promise<WeeklyPublicMove[]> {
  let rows: WeeklyWatchEventRow[];
  try {
    // PII by construction: only the event type, the system-generated title,
    // the event metadata, and the watchlist target URL are selected. The
    // watchlist name, user id, and every other customer string stay in D1.
    rows = await queryAll<WeeklyWatchEventRow>(
      env,
      `
        SELECT
          we.event_type,
          we.title,
          we.metadata_json,
          we.created_at,
          w.target_id
        FROM watch_event we
        INNER JOIN watchlist w ON w.id = we.watchlist_id
        WHERE we.created_at >= ?
          AND we.status = 'confirmed'
          AND w.target_type = 'advertiser'
        ORDER BY we.created_at DESC
        LIMIT ?
      `,
      since,
      WEEKLY_MOVES_EVENT_READ_LIMIT,
    );
  } catch (error) {
    if (isMissingTableError(error, "watch_event")) {
      return [];
    }
    console.warn("Weekly public moves: watch_event read failed; omitting event moves.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return [];
  }

  const moves: WeeklyPublicMove[] = [];
  for (const row of rows) {
    const domain = domainFromWatchlistTargetId(row.target_id);
    if (!domain || !sets.allowed.has(domain)) {
      continue;
    }
    const move = watchEventRowToPublicMove(row, domain, linksForDomain(domain, sets));
    if (move) {
      moves.push(move);
    }
  }
  return moves;
}

async function loadSnapshotMoves(
  env: AppEnv,
  since: string,
  sets: IndexableDomainSets,
): Promise<WeeklyPublicMove[]> {
  let rows: TimelineSitemapRow[];
  try {
    rows = await queryAll<TimelineSitemapRow>(
      env,
      `
        SELECT
          landing_page_snapshot.id,
          landing_page_snapshot.canonical_url,
          landing_page_snapshot.captured_at,
          landing_page_snapshot.artifact_key,
          landing_page_snapshot.metadata_json,
          EXISTS(
            SELECT 1 FROM ad_observation ao
            WHERE ao.landing_page_snapshot_id = landing_page_snapshot.id
              AND ao.ad_id IS NOT NULL
          ) AS is_ad_destination
        FROM landing_page_snapshot
        WHERE (canonical_url LIKE 'https://%' OR canonical_url LIKE 'http://%')
          AND captured_at >= ?
        ORDER BY captured_at DESC, id DESC
        LIMIT ?
      `,
      since,
      WEEKLY_MOVES_SNAPSHOT_READ_LIMIT,
    );
  } catch (error) {
    if (isMissingTableError(error, "landing_page_snapshot")) {
      return [];
    }
    console.warn("Weekly public moves: snapshot read failed; omitting snapshot moves.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return [];
  }

  // Candidate domains: indexable domains with at least one in-window
  // snapshot, most-recent-capture first, capped so the per-domain ledger
  // reads stay bounded.
  const newestCaptureByDomain = new Map<string, string>();
  for (const row of rows) {
    const domain = timelineDomainFromSnapshotRow(row);
    if (!domain || !sets.allowed.has(domain)) {
      continue;
    }
    const existing = newestCaptureByDomain.get(domain);
    if (!existing || row.captured_at > existing) {
      newestCaptureByDomain.set(domain, row.captured_at);
    }
  }
  const candidateDomains = [...newestCaptureByDomain.entries()]
    .sort((left, right) => right[1].localeCompare(left[1]))
    .slice(0, WEEKLY_MOVES_DOMAIN_LIMIT)
    .map(([domain]) => domain);

  const moves: WeeklyPublicMove[] = [];
  for (const domain of candidateDomains) {
    let ledger: OfferTimelineLoad;
    try {
      // The full per-domain ledger (proof gate, ad-destination gate, and
      // capture-validity suppression included) — the before side of a
      // transition can predate the window, so the diff baseline must come
      // from the same read the public timeline renders.
      ledger = await loadOfferTimeline(env, { domain, asOf: null });
    } catch (error) {
      console.warn("Weekly public moves: offer ledger read failed; skipping domain.", {
        domain,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      continue;
    }
    const links = linksForDomain(domain, sets);
    for (const entry of ledger.entries) {
      if (entry.capturedAt < since) {
        continue;
      }
      moves.push(...offerLedgerEntryToPublicMoves(entry, domain, links));
    }
  }
  return moves;
}

/**
 * The last-7-days public moves across sitemap-indexable domains, newest
 * first, deduped on (domain, field, before, after) and capped at
 * WEEKLY_MOVES_LIMIT. Stored rows only — this function never triggers live
 * scraping, Browser Rendering, or any paid operation. An empty result is the
 * honest quiet state, not an error.
 */
export async function loadWeeklyPublicMoves(
  env: AppEnv,
  input: { since: string },
): Promise<WeeklyPublicMove[]> {
  const sets = await loadIndexableDomainSets(env);
  if (sets.allowed.size === 0) {
    // No public brand or timeline pages → nothing may be published, no
    // matter what customer watchlists captured (the privacy gate).
    return [];
  }

  const [eventMoves, snapshotMoves] = await Promise.all([
    loadWatchEventMoves(env, input.since, sets),
    loadSnapshotMoves(env, input.since, sets),
  ]);

  const seen = new Set<string>();
  const moves: WeeklyPublicMove[] = [];
  for (const move of [...eventMoves, ...snapshotMoves]) {
    // Final move-validity gate (issue #3128): a placeholder or baseline-only
    // row can never reach the move list, whichever source produced it. The
    // mappers already apply this rule; this pass covers future sources and
    // the regression test pins it so a placeholder row reaching the list
    // again fails CI.
    if (!isPublishableWeeklyMove(move)) {
      continue;
    }
    const key = `${move.domain}|${move.field}|${move.beforeText ?? ""}|${move.afterText ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    moves.push(move);
  }
  moves.sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
  return moves.slice(0, WEEKLY_MOVES_LIMIT);
}
