/**
 * Proof archive data layer (issue #2173) — bounded D1 reads only.
 *
 * Two reads feed the one engine in `archive.ts`:
 *
 * - `loadPublicDomainArchive` — the public `/timeline/:domain` surface. It
 *   reuses `loadOfferTimeline` wholesale, so every existing public honesty
 *   gate (brand-page gate #1729, proof gate #1284, ad-destination exclusion)
 *   applies unchanged, then projects through `toPublicArchive` as a
 *   mechanical guarantee that nothing workspace-private can leak.
 * - `loadWatchlistArchive` — the signed-in side: everything the account
 *   captured (watch events in any status, the watchlist's own run-linked
 *   landing-page snapshots, its observed ads, its run cadence for gaps).
 *
 * Neither read ever triggers a live capture, a scrape, or any paid operation.
 */

import {
  archiveEntriesFromOfferLedger,
  archiveEntriesFromWatchEvents,
  buildAdTenure,
  buildOfferHistorySeries,
  computeCaptureGaps,
  emptyDomainArchive,
  sortArchiveEntriesDesc,
  summarizeArchiveMonth,
  toPublicArchive,
  type ArchiveAdTenureInput,
  type DomainArchive,
} from "~/lib/archive";
import { queryAll } from "~/lib/data/d1.server";
import {
  toWatchEventRecord,
  type WatchEventRow,
} from "~/lib/data/watchlist-rows.server";
import type { AppEnv } from "~/lib/env.server";
import {
  domainUrlBindings,
  domainUrlPredicates,
  listDomainSnapshotCaptureTimes,
  loadOfferTimeline,
  rowToSnapshot,
  type LandingPageSnapshotRow,
} from "~/lib/offer-timeline.server";
import { buildOfferLedger, type OfferLedgerEntry } from "~/lib/offer-timeline";
import { proofScreenshotSrc } from "~/lib/proof-screenshot";
import type { WatchlistRecord } from "~/lib/types";

const ARCHIVE_EVENT_LIMIT = 200;
const ARCHIVE_SNAPSHOT_LIMIT = 200;
const ARCHIVE_RUN_LIMIT = 400;
const ARCHIVE_AD_LIMIT = 100;

export interface PublicDomainArchiveLoad {
  /** The proof-gated offer ledger, exactly as `loadOfferTimeline` returns it. */
  entries: OfferLedgerEntry[];
  asOfState: OfferLedgerEntry | null;
  /** The public archive projection — public-ad facts only. */
  archive: DomainArchive;
}

interface AdTenureRow {
  id: string;
  preview_headline: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
  is_active: number;
  first_observed_at?: string | null;
  last_observed_at?: string | null;
}

function tenureRowToInput(row: AdTenureRow): ArchiveAdTenureInput {
  return {
    id: row.id,
    label: row.preview_headline,
    firstSeenAt: row.first_seen_at ?? row.first_observed_at ?? null,
    lastSeenAt: row.last_seen_at ?? row.last_observed_at ?? null,
    isActive: row.is_active === 1,
  };
}

/**
 * Stored ads whose landing page belongs to `domain` — the same rows the
 * public `/ads/:domain` wall already shows, so first/last-seen tenure here is
 * a public-ad fact, not a workspace secret.
 */
async function listPublicDomainAdTenure(
  env: AppEnv,
  domain: string,
): Promise<ArchiveAdTenureInput[]> {
  if (!env.DB) return [];
  try {
    const rows = await queryAll<AdTenureRow>(
      env,
      `
        SELECT
          ad.id,
          ad.preview_headline,
          ad.first_seen_at,
          ad.last_seen_at,
          ad.is_active
        FROM ad
        WHERE
          ${domainUrlPredicates("ad.landing_page_url")}
        ORDER BY ad.first_seen_at ASC, ad.id ASC
        LIMIT ?
      `,
      ...domainUrlBindings(domain),
      ARCHIVE_AD_LIMIT,
    );
    return rows.map(tenureRowToInput);
  } catch {
    // The tenure strip is additive; a read failure must never take the
    // public timeline down.
    return [];
  }
}

export async function loadPublicDomainArchive(
  env: AppEnv,
  input: { domain: string; asOf: string | null; now?: Date },
): Promise<PublicDomainArchiveLoad> {
  const now = input.now ?? new Date();
  const [timeline, adTenure] = await Promise.all([
    loadOfferTimeline(env, { domain: input.domain, asOf: input.asOf }),
    listPublicDomainAdTenure(env, input.domain),
  ]);
  // Gap honesty wants EVERY capture time, including proof-less rows the
  // ledger gates out. If that read fails, fall back to the ledger's own
  // capture timestamps — the gaps we can prove, never a smoothed-over
  // silence. (A real D1 outage fails `loadOfferTimeline` above first, so
  // this fallback only ever covers a partial read.)
  const captureTimes = await listDomainSnapshotCaptureTimes(env, {
    domain: input.domain,
  }).catch(() => timeline.entries.map((entry) => entry.capturedAt));

  const entries = archiveEntriesFromOfferLedger(timeline.entries);
  const archive = toPublicArchive(
    {
      subject: input.domain,
      generatedAt: now.toISOString(),
      entries: sortArchiveEntriesDesc(entries),
      gaps: computeCaptureGaps(captureTimes),
      adTenure: buildAdTenure(adTenure, now),
      offerHistory: buildOfferHistorySeries(timeline.entries),
      monthSummary: summarizeArchiveMonth(entries, now),
    },
    now,
  );

  return { entries: timeline.entries, asOfState: timeline.asOfState, archive };
}

/** Events with the linked proof capture's screenshot key, newest first. */
async function listArchiveWatchEvents(env: AppEnv, watchlistId: string) {
  const rows = await queryAll<
    WatchEventRow & { proof_screenshot_key: string | null }
  >(
    env,
    `
      SELECT
        watch_event.*,
        proof_capture.screenshot_artifact_key AS proof_screenshot_key
      FROM watch_event
        LEFT JOIN proof_capture ON proof_capture.id = watch_event.proof_capture_id
      WHERE watch_event.watchlist_id = ?
      ORDER BY watch_event.created_at DESC, watch_event.id DESC
      LIMIT ?
    `,
    watchlistId,
    ARCHIVE_EVENT_LIMIT,
  );
  return rows.map((row) => ({
    event: toWatchEventRecord(row),
    proofScreenshotHref: proofScreenshotSrc(row.proof_screenshot_key),
  }));
}

/**
 * Landing-page snapshots captured BY this watchlist's runs (via
 * `ad_observation`). No public proof gate — the account owns these rows; the
 * honesty label (`evidenceNote`) names any capture that has no artifacts.
 */
async function listWatchlistSnapshots(env: AppEnv, watchlistId: string) {
  const rows = await queryAll<LandingPageSnapshotRow>(
    env,
    `
      SELECT
        s.id,
        s.canonical_url,
        s.raw_headline,
        s.cta_text,
        s.price_text,
        s.form_present,
        s.artifact_key,
        s.metadata_json,
        s.capture_method,
        s.captured_at,
        NULL AS is_ad_destination
      FROM landing_page_snapshot s
      INNER JOIN ad_observation ao ON ao.landing_page_snapshot_id = s.id
      INNER JOIN watchlist_run wr ON wr.id = ao.watchlist_run_id
      WHERE wr.watchlist_id = ?
      GROUP BY s.id
      ORDER BY s.captured_at ASC, s.id ASC
      LIMIT ?
    `,
    watchlistId,
    ARCHIVE_SNAPSHOT_LIMIT,
  );
  return rows.map(rowToSnapshot);
}

/** Run start times — the account's real capture cadence, for gap honesty. */
async function listWatchlistRunTimes(env: AppEnv, watchlistId: string) {
  const rows = await queryAll<{ started_at: string }>(
    env,
    `
      SELECT started_at
      FROM watchlist_run
      WHERE watchlist_id = ?
      ORDER BY started_at ASC
      LIMIT ?
    `,
    watchlistId,
    ARCHIVE_RUN_LIMIT,
  );
  return rows.map((row) => row.started_at);
}

/** Ads this watchlist's runs observed, with stored first/last seen. */
async function listWatchlistAdTenure(env: AppEnv, watchlistId: string) {
  const rows = await queryAll<AdTenureRow>(
    env,
    `
      SELECT
        ad.id,
        ad.preview_headline,
        ad.first_seen_at,
        ad.last_seen_at,
        ad.is_active,
        MIN(ao.seen_at) AS first_observed_at,
        MAX(ao.seen_at) AS last_observed_at
      FROM ad_observation ao
      INNER JOIN ad ON ad.id = ao.ad_id
      INNER JOIN watchlist_run wr ON wr.id = ao.watchlist_run_id
      WHERE wr.watchlist_id = ?
      GROUP BY ad.id
      ORDER BY first_observed_at ASC, ad.id ASC
      LIMIT ?
    `,
    watchlistId,
    ARCHIVE_AD_LIMIT,
  );
  return rows.map(tenureRowToInput);
}

/**
 * Everything the account captured for one watchlist. The caller must have
 * already verified ownership (`getWatchlist(env, id, userId)`); this read is
 * scoped by watchlist id only.
 */
export async function loadWatchlistArchive(
  env: AppEnv,
  input: { watchlist: WatchlistRecord; now?: Date },
): Promise<DomainArchive> {
  const now = input.now ?? new Date();
  if (!env.DB) {
    return emptyDomainArchive(input.watchlist.targetLabel, now);
  }

  const [eventRows, snapshots, runTimes, adTenure] = await Promise.all([
    listArchiveWatchEvents(env, input.watchlist.id),
    listWatchlistSnapshots(env, input.watchlist.id),
    listWatchlistRunTimes(env, input.watchlist.id),
    listWatchlistAdTenure(env, input.watchlist.id),
  ]);

  const hrefByEventId = new Map(
    eventRows.map((row) => [row.event.id, row.proofScreenshotHref]),
  );
  const ledger = buildOfferLedger(snapshots);
  const entries = sortArchiveEntriesDesc([
    ...archiveEntriesFromWatchEvents(
      eventRows.map((row) => row.event),
      { proofScreenshotHref: (event) => hrefByEventId.get(event.id) ?? null },
    ),
    ...archiveEntriesFromOfferLedger(ledger),
  ]);

  return {
    subject: input.watchlist.targetLabel,
    generatedAt: now.toISOString(),
    entries,
    gaps: computeCaptureGaps(runTimes),
    adTenure: buildAdTenure(adTenure, now),
    offerHistory: buildOfferHistorySeries(ledger),
    monthSummary: summarizeArchiveMonth(entries, now),
  };
}
