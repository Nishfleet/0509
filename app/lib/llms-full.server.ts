/**
 * `/llms-full.txt` — public full-text AEO feed of tracked-brand offer/proof
 * records (issue #2043).
 *
 * Where `/llms.txt` exposes only page metadata (titles + URLs), this feed
 * publishes the dated, source-backed offer/proof/change records themselves so
 * an AI answer engine or agent can cite a tracked brand's dated offer state
 * directly from the AEO content surface, without rendering the HTML timeline.
 *
 * Honesty rules — identical to `/timeline/:domain` (issue #1284 / #1729 / #1957
 * / #1996 / #2021) because the feed reuses the SAME evidence path:
 *
 *   - Reads only stored `landing_page_snapshot` rows (bounded D1 read). A
 *     public request NEVER triggers live scraping, Browser Rendering, or any
 *     paid operation.
 *   - Reuses `loadIndexableTimelineEntries` (the sitemap's own bounded read) +
 *     `rowToSnapshot` + `buildOfferLedger`, so the proof gate (both screenshot
 *     AND page-text artifacts), the ad-destination gate, the per-domain
 *     first-`TIMELINE_SNAPSHOT_LIMIT` window, and the run-collapse / suppressed
 *     rules are byte-for-byte the loader's rules — never re-derived.
 *   - Emits ONLY brands whose ledger survives those gates (real captured
 *     data). A brand with no proof-complete capture is omitted entirely; the
 *     feed never fabricates an uncaptured offer state.
 *   - Each dated state carries its capture date ("as of <date>"), the offer
 *     fields that were actually captured (headline / CTA / price / form
 *     present), the screenshot and page-text evidence links (only when valid
 *     artifact keys exist), the run-extent / suppressed freshness labels, and
 *     a Meta Ad Library source link for the brand.
 *   - Degrades to an honest empty feed (header only) when D1 is absent or the
 *     table is missing — never a 500, never invented rows.
 *
 * The feed is a route/loader served from `workers/app.ts`, not a checked-in
 * blob. Revert is a pure code revert; no D1 rollback is required (issue #2043
 * constraints 12–15).
 */

import { queryAll } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import {
  buildOfferLedger,
  canonicalUrlBelongsToDomain,
  formatOfferDate,
  type OfferLedgerEntry,
  type OfferSnapshotInput,
} from "~/lib/offer-timeline";
import {
  rowToSnapshot,
  snapshotRowHasCompleteProof,
  TIMELINE_SNAPSHOT_LIMIT,
  type LandingPageSnapshotRow,
} from "~/lib/offer-timeline.server";
import { canonicalUrl } from "~/lib/seo";
import {
  timelineDomainFromSnapshotRow,
  type TimelineSitemapRow,
} from "~/lib/sitemap.server";

/**
 * Hard bound on distinct brands emitted in the feed. Mirrors
 * `SITEMAP_TIMELINE_PATH_LIMIT` (the sitemap's own /timeline/:domain cap) so
 * the feed and the sitemap advertise the same brand surface and neither can
 * grow unbounded. Kept local (not imported) so this module has no dependency
 * on the sitemap cap constant — the value is documented here and pinned by
 * tests.
 */
export const LLMS_FULL_BRAND_LIMIT = 1000;

/**
 * The public Meta Ad Library search URL for a brand domain. The Ad Library is
 * the declared source of the ad creatives whose landing pages the timeline
 * captures; the feed names it as the source so an answer engine can attribute
 * the ad side of the proof chain. Uses advertiser-mode keyword search (the
 * same `search_type=keyword_unordered` posture `buildSearchUrl` in
 * `meta-library-browser.server.ts` uses for domain searches), not a guessed
 * page id — we never fabricate a verified page match.
 */
export function metaAdLibrarySourceUrl(domain: string): string {
  const params = new URLSearchParams({
    ad_type: "all",
    search_type: "keyword_unordered",
    q: domain,
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

/** A brand block in the feed: the domain plus its dated ledger. */
export interface LlmsFullBrandBlock {
  domain: string;
  /** Timeline URL on the canonical origin, for cross-linking. */
  timelineUrl: string;
  /** Meta Ad Library source URL for the brand. */
  adLibrarySourceUrl: string;
  /** Newest capture date in the ledger, as `YYYY-MM-DD`. */
  asOf: string;
  entries: OfferLedgerEntry[];
}

/**
 * Group the bounded sitemap timeline rows into per-domain ledger blocks,
 * applying the loader's own gates. Pure (no D1) so the grouping rules are
 * unit-testable without a database. Reuses `rowToSnapshot` + `buildOfferLedger`
 * so the dated states, run-collapse, suppressed, and transition logic are the
 * loader's exact logic.
 *
 * The input MUST be ordered `captured_at ASC, id ASC` (the loader's own
 * window order) — `loadIndexableTimelineEntries` already returns it that way.
 */
export function buildLlmsFullBrandBlocks(
  rows: readonly LandingPageSnapshotRow[],
): LlmsFullBrandBlock[] {
  // Group by derived registrable domain, mirroring
  // `indexableTimelineEntriesFromRows`. Rows whose URL cannot be losslessly
  // mapped to a /timeline/:domain param are dropped (rule 10 of the sitemap
  // docblock).
  const byDomain = new Map<string, LandingPageSnapshotRow[]>();
  for (const row of rows) {
    const domain = timelineDomainFromSnapshotRow(row);
    if (!domain) {
      continue;
    }
    let bucket = byDomain.get(domain);
    if (!bucket) {
      bucket = [];
      byDomain.set(domain, bucket);
    }
    bucket.push(row);
  }

  const blocks: LlmsFullBrandBlock[] = [];
  for (const [domain, bucket] of byDomain) {
    // Loader's per-domain window: only the first TIMELINE_SNAPSHOT_LIMIT rows
    // (input is ASC, matching the loader's `ORDER BY ... ASC LIMIT 200`).
    const window =
      bucket.length > TIMELINE_SNAPSHOT_LIMIT
        ? bucket.slice(0, TIMELINE_SNAPSHOT_LIMIT)
        : bucket;

    // Apply the loader's three gates in order: brand-page (canonical URL
    // belongs to the domain), ad-destination (exclude), proof (both artifacts
    // present). Then map to the pure ledger input shape. This is exactly
    // `loadOfferTimeline`'s pipeline, reused row-for-row.
    const snapshots: OfferSnapshotInput[] = [];
    for (const row of window) {
      if (!canonicalUrlBelongsToDomain(row.canonical_url, domain)) {
        continue;
      }
      if (row.is_ad_destination) {
        continue;
      }
      if (!snapshotRowHasCompleteProof(row)) {
        continue;
      }
      snapshots.push(rowToSnapshot(row));
    }
    if (snapshots.length === 0) {
      // No proof-complete capture for this brand — omit it entirely. The feed
      // never fabricates an uncaptured offer state (issue #2043 constraint 7).
      continue;
    }

    const entries = buildOfferLedger(snapshots);
    if (entries.length === 0) {
      continue;
    }

    // "as of" = the newest capture in the ledger (the last entry, since
    // buildOfferLedger emits in ASC capture order). Use the captured_at date
    // so the label is the real capture day, not a rendered locale string.
    const asOf = entries[entries.length - 1]!.capturedAt.slice(0, 10);
    blocks.push({
      domain,
      timelineUrl: canonicalUrl(`/timeline/${domain}`),
      adLibrarySourceUrl: metaAdLibrarySourceUrl(domain),
      asOf,
      entries,
    });
    if (blocks.length >= LLMS_FULL_BRAND_LIMIT) {
      break;
    }
  }
  return blocks;
}

/**
 * Render one brand block as Markdown. Each dated state is a bullet with its
 * capture date, offer fields, evidence links, and freshness labels. The block
 * is self-contained: an answer engine can cite any single dated state with its
 * evidence link without rendering the HTML timeline.
 */
function renderBrandBlock(block: LlmsFullBrandBlock): string {
  const lines: string[] = [];
  lines.push(`## ${block.domain}`);
  lines.push("");
  lines.push(`As of ${block.asOf}.`);
  lines.push("");
  lines.push(`- Timeline: ${block.timelineUrl}`);
  lines.push(`- Meta Ad Library source: ${block.adLibrarySourceUrl}`);
  lines.push("");
  lines.push("Dated offer states:");
  for (const entry of block.entries) {
    lines.push(renderEntryLine(entry));
  }
  return lines.join("\n");
}

/**
 * Render one dated offer state as a single Markdown bullet. The evidence
 * links (screenshot / page-text) are emitted only when the artifact keys
 * validated, mirroring `proofScreenshotSrc` / `proofPageTextSrc` — a missing
 * or malformed key degrades to an honest "no screenshot" / "no page text"
 * label instead of a broken link.
 */
function renderEntryLine(entry: OfferLedgerEntry): string {
  const date = entry.capturedAt.slice(0, 10);
  const parts: string[] = [`**${date}**`];

  if (entry.headline) {
    parts.push(`headline: ${entry.headline}`);
  }
  if (entry.ctaText) {
    parts.push(`CTA: ${entry.ctaText}`);
  }
  if (entry.priceText) {
    parts.push(`price: ${entry.priceText}`);
  }
  if (entry.formPresent !== null) {
    parts.push(`form: ${entry.formPresent ? "present" : "absent"}`);
  }

  // Evidence links — only when the artifact keys validated (the ledger
  // already nulls invalid keys via proofScreenshotSrc / proofPageTextSrc).
  const evidence: string[] = [];
  if (entry.screenshotHref) {
    evidence.push(`[screenshot](${canonicalUrl(entry.screenshotHref)})`);
  } else {
    evidence.push("no screenshot");
  }
  if (entry.pageTextHref) {
    evidence.push(`[page text](${canonicalUrl(entry.pageTextHref)})`);
  } else {
    evidence.push("no page text");
  }
  parts.push(`evidence: ${evidence.join(", ")}`);

  // Freshness / honesty labels — emitted verbatim from the ledger so the
  // feed preserves the loader's staleness labeling instead of presenting old
  // proof as current (issue #2043 constraint 6).
  if (entry.runExtentLabel) {
    parts.push(`(${entry.runExtentLabel})`);
  }
  if (entry.suppressedReason) {
    parts.push(`[suppressed: ${entry.suppressedReason}]`);
  }
  if (entry.evidenceNote) {
    parts.push(`[${entry.evidenceNote}]`);
  }

  // Change event: emit the before/after transition when the ledger recorded
  // one (a real field change between runs). The first dated state has
  // transition null — no phantom change is fabricated.
  if (entry.transition) {
    const changes: string[] = [];
    if (entry.transition.headline) {
      changes.push(
        `headline "${entry.transition.headline.before}" -> "${entry.transition.headline.after}"`,
      );
    }
    if (entry.transition.ctaText) {
      changes.push(
        `CTA "${entry.transition.ctaText.before}" -> "${entry.transition.ctaText.after}"`,
      );
    }
    if (entry.transition.priceText) {
      changes.push(
        `price "${entry.transition.priceText.before}" -> "${entry.transition.priceText.after}"`,
      );
    }
    if (entry.transition.formPresent) {
      changes.push(
        `form ${entry.transition.formPresent.before} -> ${entry.transition.formPresent.after}`,
      );
    }
    if (changes.length > 0) {
      parts.push(`changed: ${changes.join("; ")}`);
    }
  }

  return `- ${parts.join(" · ")}`;
}

/**
 * The full `/llms-full.txt` Markdown body. The header is always present
 * (even when no brand has a proof-complete capture) so the feed degrades
 * honestly to an empty-but-served 200, never a 500 and never a fabricated
 * row.
 */
export function buildLlmsFullText(blocks: readonly LlmsFullBrandBlock[]): string {
  const header = `# Five to Nine — full-text offer/proof feed

Source-backed dated offer, proof, and change records for tracked brands, read
from the same stored captures as /timeline/:domain. Each dated state cites its
screenshot and page-text evidence and the Meta Ad Library source. Generated
from landing_page_snapshot rows only — no live scraping on this request.

See /llms.txt for the page index and /sitemap.xml for the crawlable surface.`;

  if (blocks.length === 0) {
    return `${header}

No tracked brands with proof-complete captures yet.`;
  }

  const brandLines = blocks.map(renderBrandBlock);
  return `${header}

${brandLines.join("\n\n")}`;
}

/**
 * Bounded D1 read for the feed: the same bounded read the sitemap uses
 * (`loadIndexableTimelineEntries`), re-queried here so the feed module owns
 * its own read shape (it needs the full row, not the sitemap's subset). One
 * SELECT, capped at `SITEMAP_TIMELINE_READ_LIMIT` rows, ordered
 * `captured_at ASC, id ASC` to mirror the loader's per-domain window. Missing
 * table on a fresh D1 degrades to an empty feed, never a 500.
 */
export async function loadLlmsFullBrandBlocks(
  env: AppEnv,
  readLimit: number,
): Promise<LlmsFullBrandBlock[]> {
  if (!env.DB) {
    return [];
  }
  try {
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
          EXISTS(
            SELECT 1 FROM ad_observation ao
            WHERE ao.landing_page_snapshot_id = s.id AND ao.ad_id IS NOT NULL
          ) AS is_ad_destination
        FROM landing_page_snapshot s
        WHERE s.canonical_url LIKE 'https://%' OR s.canonical_url LIKE 'http://%'
        ORDER BY s.captured_at ASC, s.id ASC
        LIMIT ?
      `,
      readLimit,
    );
    return buildLlmsFullBrandBlocks(rows);
  } catch (error) {
    if (isMissingSnapshotTable(error)) {
      return [];
    }
    throw error;
  }
}

function isMissingSnapshotTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.toLowerCase().includes("no such table") &&
    message.includes("landing_page_snapshot")
  );
}

// Re-export the sitemap row type alias so callers/tests can import the feed
// module without also importing sitemap.server.ts. The two are the same
// shape; the feed read selects the full LandingPageSnapshotRow superset.
export type { TimelineSitemapRow };
