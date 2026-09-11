/**
 * /sample-brief — the public "real Monday brief" page (issue #2136).
 *
 * One page that renders a genuine stored digest for the newest
 * sitemap-indexable brand that has at least one confirmed watch_event in the
 * last 30 days. The digest HTML is built through the existing digest builder
 * (`buildDigestEmail`) from stored rows only — never a live scrape, Browser
 * Rendering run, or paid operation.
 *
 * Privacy gates (the same honesty contract the /briefs/weekly and /ads/:domain
 * pages render under):
 *
 *   1. Domain gate: only domains returned by `loadIndexableAdsInternalLinks`
 *      (the sitemap's own indexability signal) may be picked. A
 *      customer-private, demo, stale, or otherwise non-indexable domain can
 *      never appear.
 *   2. Event gate: only `status = 'confirmed'` watch events qualify (the
 *      proof-backed set); suppressed/invalidated rows never render.
 *   3. PII by construction: the SQL selects only the event type, the
 *      system-generated title, the event metadata, and the watchlist target
 *      URL — never the watchlist name, user id, or any customer-supplied
 *      string. The brand label is derived from the public domain
 *      (`displayNameFromDomain`), never from customer input. The exact stored
 *      watchlist name is scrubbed from any title/summary that embeds it, and
 *      the digest items carry no event id or watchlist id, so the digest
 *      builder's per-item deep links resolve to the public /ads/:domain page
 *      instead of a customer workspace row.
 *
 * Reads are bounded (one capped SELECT per candidate domain) and every phase
 * degrades to the honest quiet-brief variant instead of a 500.
 */

import { loadIndexableAdsInternalLinks } from "~/lib/ads-internal-links.server";
import { registrableDomainFromLandingPage } from "~/lib/competitor-website";
import { queryAll, queryIn } from "~/lib/data/d1.server";
import { parseJson } from "~/lib/data/helpers.server";
import type { WatchEventRow } from "~/lib/data/watchlist-rows.server";
import { appBaseUrl } from "~/lib/delivery-email-core.server";
import { buildDigestEmail } from "~/lib/digest-email.server";
import type { AppEnv } from "~/lib/env.server";
import type { DigestTrustItem } from "~/lib/proof-classification";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import { formatWatchEventTypeLabel } from "~/lib/watch-event-display";

/** The default rolling window the sample brief covers (30 days). */
export const SAMPLE_BRIEF_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Widening tiers the sample brief walks, newest-first (issue #2969).
 *
 * Buyers inspect /sample-brief before paying, and a 30-day window can render
 * the all-quiet variant when the monitored brand simply has not changed
 * recently — the page then leads with "nothing happened", which reads as a
 * broken product. The window widens tier by tier (30 → 90 → 180 → 365 days)
 * until some indexable brand has a stored confirmed change, and the period
 * the brief reports is always the tier that actually produced the rows, so
 * the honest-labelling contract holds — the page never fabricates recency.
 */
export const SAMPLE_BRIEF_WINDOW_TIERS_MS = [
  SAMPLE_BRIEF_WINDOW_MS,
  90 * 24 * 60 * 60 * 1000,
  180 * 24 * 60 * 60 * 1000,
  365 * 24 * 60 * 60 * 1000,
] as const;

/** Human-readable label for a window tier, used in quiet-brief copy. */
export function sampleBriefWindowLabel(ms: number): string {
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  return days >= 365 ? "365 days" : `${days === 30 ? "30" : days} days`;
}
/** Hard bound on rendered digest items per brief. */
export const SAMPLE_BRIEF_EVENT_LIMIT = 20;

export interface SampleBriefData {
  /** Registrable domain the brief is about (lowercased, no www). */
  domain: string;
  /** Public brand label derived from the domain — never customer input. */
  brand: string;
  /** The digest HTML built by the existing digest builder. */
  digestHtml: string;
  /** True when no domain qualified and the honest quiet-brief rendered. */
  quiet: boolean;
  /** ISO start of the 30-day window. */
  periodStart: string;
  /** ISO end of the 30-day window. */
  periodEnd: string;
}

/** Subset of watch_event/watchlist columns the sample-brief read selects. */
interface SampleBriefWatchEventRow {
  id: string;
  event_type: string;
  status: string;
  title: string;
  summary: string;
  metadata_json: string;
  created_at: string;
  target_id: string;
}

function isMissingTableError(error: unknown, table: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("no such table") && message.includes(table);
}

/**
 * Map one confirmed watch_event row to a public digest item. The item carries
 * no event id or watchlist id (so the digest builder's per-item deep link
 * falls back to the public full-digest URL). The title is derived from the
 * event type (system vocabulary, never customer input) and the summary is a
 * generic safe line — the stored title/summary can embed the owner's
 * watchlist name, user id, or other account identifiers, so they are never
 * used verbatim on the public page. The change mark (from/to) rides in the
 * metadata so the digest builder renders the actual competitor change.
 */

/**
 * The only metadata keys the public sample brief may carry. The raw stored
 * metadata can embed customer identifiers (e.g. `proofTargetIdentity` is
 * built as `[watchlistId, adId, canonicalPageIdentity].join(":")`), so the
 * whole record is never spread — only this known-safe allowlist is extracted,
 * mirroring the safe keys the real digest orchestration reads.
 */
const SAMPLE_BRIEF_SAFE_METADATA_KEYS = [
  "from",
  "to",
  "sourceUrl",
  "proofUrl",
  "landingPageUrl",
  "websiteUrl",
  "websiteProofUrl",
  "canonicalUrl",
  "capturedAt",
  "beforeCapturedAt",
] as const;

function watchEventRowToDigestItem(
  row: SampleBriefWatchEventRow,
): DigestTrustItem {
  const raw = parseJson<Record<string, unknown>>(row.metadata_json, {});
  const metadata: Record<string, unknown> = {};
  for (const key of SAMPLE_BRIEF_SAFE_METADATA_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) {
      metadata[key] = value.trim();
    }
  }
  return {
    eventType: row.event_type,
    title: formatWatchEventTypeLabel(row.event_type),
    summary: "A stored change was captured for this brand.",
    createdAt: row.created_at,
    metadata: {
      ...metadata,
      // The digest builder's decision-candidate gate reads these fields to
      // classify a confirmed stored event as a rankable move (the same
      // classification the real digest orchestration applies via
      // `digestMetadataForEvent`). A confirmed row with no proof capture is
      // `scan_backed`; the event status rides along for the honesty label.
      sourceStatus: "scan_backed",
      eventStatus: row.status,
    },
  };
}

/**
 * Load the newest sitemap-indexable domain that has at least one confirmed
 * watch_event in the sample window, and build its digest HTML through the
 * existing digest builder from stored rows only. The window widens tier by
 * tier (30 → 90 → 180 → 365 days — issue #2969) until a stored change is
 * found, so the page leads with a real detected change instead of an empty
 * week. Every period the digest names is the tier that produced its rows;
 * when no domain qualifies even at the widest tier, returns the honest
 * quiet-brief variant for the newest indexable domain.
 */
export async function loadSampleBrief(env: AppEnv): Promise<SampleBriefData> {
  const links = await loadIndexableAdsInternalLinks(env);
  if (links.length === 0) {
    // No indexable brand page at all → the honest quiet-brief with no brand.
    return quietBrief(env, "", "", SAMPLE_BRIEF_WINDOW_TIERS_MS[0]);
  }

  // Newest-first: the sitemap's indexable set is ordered by the sitemap's own
  // recency signal, so the first domain with a stored event wins. The
  // advertiser-watchlist candidate set is loaded ONCE (not per domain) so a
  // crawl of this public page never issues a full-table scan per candidate.
  const watchlistCandidates = await loadAdvertiserWatchlistCandidates(env);
  if (watchlistCandidates.length === 0) {
    // Nothing for any advertiser watchlist to match → honest quiet-brief.
    return quietBrief(env, links[0]!.domain, links[0]!.name, SAMPLE_BRIEF_WINDOW_TIERS_MS[0]);
  }
  const baseUrl = appBaseUrl(env);

  // Walk the window tiers earliest-first: the shallowest tier that yields a
  // stored confirmed change wins. Reads stay bounded — it is still one capped
  // SELECT per candidate domain per tier, and the page makes at most four
  // passes over the (small, sitemap-sized) candidate set before degrading to
  // the honest quiet-brief.
  for (const tier of SAMPLE_BRIEF_WINDOW_TIERS_MS) {
    const tierEnd = new Date().toISOString();
    const tierStart = new Date(Date.now() - tier).toISOString();
    for (const link of links) {
      const events = await loadRecentEventsForDomain(
        env,
        link.domain,
        tierStart,
        watchlistCandidates,
      );
      if (events.length > 0) {
        const items = events.map(watchEventRowToDigestItem);
        const digest = buildDigestEmail({
          name: "",
          periodStart: tierStart,
          periodEnd: tierEnd,
          items,
          cadence: "weekly",
          baseUrl,
          fullDigestUrl: `${baseUrl}/ads/${link.domain}`,
          manageFrequencyUrl: `${baseUrl}/auth/signup`,
          supportEmail: SUPPORT_EMAIL,
          supportMailto: SUPPORT_MAILTO,
          unsubscribeUrl: null,
        });
        return {
          domain: link.domain,
          brand: link.name,
          digestHtml: digest.html,
          quiet: false,
          periodStart: tierStart,
          periodEnd: tierEnd,
        };
      }
    }
  }

  // No domain had a stored event even at the widest tier → the honest
  // quiet-brief for the newest indexable domain, over the widest window.
  return quietBrief(env, links[0]!.domain, links[0]!.name, SAMPLE_BRIEF_WINDOW_TIERS_MS.at(-1)!);
}


/**
 * The honest quiet-brief for a given domain over `windowMs`. The counts are
 * honest for a public page: no scan runs are attributed, so the record
 * states that no confirmed changes were captured in the window.
 */
function quietBrief(
  env: AppEnv,
  domain: string,
  brand: string,
  windowMs: number,
): SampleBriefData {
  const periodEnd = new Date().toISOString();
  const periodStart = new Date(Date.now() - windowMs).toISOString();
  return {
    domain,
    brand,
    digestHtml: buildQuietBriefHtml(env, domain, periodStart, periodEnd, windowMs),
    quiet: true,
    periodStart,
    periodEnd,
  };
}

/**
 * Load the active advertiser-watchlist candidate set (id + target URL) once.
 * PII by construction: only the watchlist id and target URL are selected —
 * the watchlist name (a customer-supplied string) is never read. Returns []
 * on a missing table or D1 hiccup so the page degrades to the quiet-brief.
 */
async function loadAdvertiserWatchlistCandidates(
  env: AppEnv,
): Promise<{ id: string; target_id: string }[]> {
  if (!env.DB) {
    return [];
  }
  try {
    return await queryAll<{ id: string; target_id: string }>(
      env,
      `
        SELECT id, target_id
        FROM watchlist
        WHERE target_type = 'advertiser'
          AND is_active = 1
      `,
    );
  } catch (error) {
    if (isMissingTableError(error, "watchlist")) {
      return [];
    }
    console.warn("Sample brief: watchlist read failed; quiet-brief.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return [];
  }
}

/**
 * Load confirmed watch_events for a single registrable domain captured in
 * the last `since` refinement of the caller's window tier, newest first,
 * capped at SAMPLE_BRIEF_EVENT_LIMIT. Returns []
 * when no watchlist tracks the domain or D1 is absent. The advertiser
 * candidate set is passed in (loaded once by the caller) so this never
 * re-scans the watchlist table per domain.
 */
async function loadRecentEventsForDomain(
  env: AppEnv,
  domain: string,
  since: string,
  candidates: { id: string; target_id: string }[],
): Promise<SampleBriefWatchEventRow[]> {
  if (!env.DB) {
    return [];
  }
  const watchlistIds = candidates
    .filter((row) => registrableDomainFromLandingPage(row.target_id) === domain)
    .map((row) => row.id);
  if (watchlistIds.length === 0) {
    return [];
  }

  let rows: WatchEventRow[];
  try {
    rows = await queryIn<WatchEventRow>(env, {
      buildSql: (placeholders) => `
        SELECT *
        FROM watch_event
        WHERE watchlist_id IN (${placeholders})
          AND status = 'confirmed'
          AND created_at >= ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
      values: watchlistIds,
      suffix: [since, SAMPLE_BRIEF_EVENT_LIMIT],
    });
  } catch (error) {
    if (isMissingTableError(error, "watch_event")) {
      return [];
    }
    console.warn("Sample brief: watch_event read failed; quiet-brief.", {
      domain,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return [];
  }

  // queryIn's LIMIT applies per chunk — re-order and bound the merged window
  // so the cap holds for any number of matching watchlists.
  return rows
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
    )
    .slice(0, SAMPLE_BRIEF_EVENT_LIMIT)
    .map((row) => ({
      id: row.id,
      event_type: row.event_type,
      status: row.status,
      title: row.title,
      summary: row.summary,
      metadata_json: row.metadata_json,
      created_at: row.created_at,
      target_id: "",
    }));
}

/**
 * The honest quiet-brief variant: a real digest built from the empty item set
 * plus an all-quiet heartbeat so the page renders the digest builder's
 * truthful "checked and nothing moved" state instead of a fabricated list or a
 * failure email. The counts are honest for a public page: no scan runs are
 * attributed, so the record states that no confirmed changes were captured
 * in the window.
 */
function buildQuietBriefHtml(
  env: AppEnv,
  domain: string,
  periodStart: string,
  periodEnd: string,
  windowMs: number,
): string {
  const digest = buildDigestEmail({
    name: "",
    periodStart,
    periodEnd,
    items: [],
    cadence: "weekly",
    heartbeat: {
      runs: 0,
      watchlistsChecked: 0,
      adsSeen: 0,
      triage: {
        status: "all_quiet",
        label: "All quiet",
        explanation: `No confirmed competitor changes were captured for this brand in the last ${sampleBriefWindowLabel(windowMs)}.`,
        checkedAt: null,
        checksCompleted: 0,
        suppressedChanges: 0,
        suppressionReasons: [],
        nextAction: "Check back after the next scheduled capture.",
        noActionLine: "No action needed right now.",
      },
    },
    fullDigestUrl: domain ? `${appBaseUrl(env)}/ads/${domain}` : appBaseUrl(env),
    baseUrl: appBaseUrl(env),
    manageFrequencyUrl: `${appBaseUrl(env)}/auth/signup`,
    supportEmail: SUPPORT_EMAIL,
    supportMailto: SUPPORT_MAILTO,
    unsubscribeUrl: null,
  });
  return digest.html;
}
