/**
 * /llms-full.txt — public full-text AI grounding corpus (issue #2043).
 *
 * /llms.txt is a page INDEX (one titled link per canonical page); answer
 * engines additionally need a full-text corpus they can ground a dated
 * "what did <brand>'s offer say on <date>" answer on. This module renders
 * that corpus as markdown, generated READ-ONLY from the same stored
 * `landing_page_snapshot` evidence the /timeline/:domain surface reads —
 * the same proof gates, the same per-domain window, the same bounded D1
 * read cost envelope as the sitemap timeline lister. A public request must
 * NEVER trigger live scraping, Browser Rendering, or any other paid
 * operation, and a fresh D1 without the snapshot table degrades to an
 * honest empty feed, never a 500.
 *
 * Honesty gate (north star, BET 10):
 * - A brand section is emitted only when at least one stored capture
 *   survives the SAME proof gate the /timeline/:domain loader applies
 *   (screenshot AND page-text artifacts stored). A brand with no captured
 *   data never appears; an offer state that was never captured is never
 *   written.
 * - Every "As of" date is the UTC date of the stored capture, and every
 *   state links its stored screenshot + page-text evidence. Nothing is
 *   synthesized.
 * - Stale proof is labeled with the site's existing freshness vocabulary
 *   (formatBrandPageCheckedAgo) plus an explicit STALE marker once the
 *   newest capture is older than BRAND_PAGE_FRESH_FOR_INDEXING_MS — the
 *   same 7-day window every other 0509 indexing surface uses.
 */

import {
  BRAND_PAGE_FRESH_FOR_INDEXING_MS,
  formatBrandPageCheckedAgo,
  normalizeBrandPageDomain,
} from "~/lib/brand-page.server";
import { queryAll } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import {
  buildOfferLedger,
  canonicalUrlBelongsToDomain,
  type OfferLedgerEntry,
} from "~/lib/offer-timeline";
import {
  rowToSnapshot,
  snapshotRowHasCompleteProof,
  TIMELINE_SNAPSHOT_LIMIT,
} from "~/lib/offer-timeline.server";
import {
  SITEMAP_TIMELINE_PATH_LIMIT,
  SITEMAP_TIMELINE_READ_LIMIT,
  timelineDomainFromSnapshotRow,
  type TimelineSitemapRow,
} from "~/lib/sitemap.server";
import { canonicalUrl } from "~/lib/seo";

/** Snapshot row shape this feed reads: the sitemap timeline row PLUS the
 * offer-state columns the ledger builder needs. */
export interface LlmsFullSnapshotRow extends TimelineSitemapRow {
  raw_headline: string;
  cta_text: string | null;
  price_text: string | null;
  form_present: number | null;
  capture_method: string | null;
}

/** One brand's dated offer ledger as the feed renders it. */
export interface LlmsFullBrandTimeline {
  domain: string;
  brandName: string;
  entries: OfferLedgerEntry[];
}

/**
 * Pure core: reduce snapshot rows (ordered `captured_at ASC, id ASC`, the
 * loader's own window order) into per-brand dated ledgers. Mirrors the
 * sitemap timeline lister's gates exactly — canonical-URL domain recovery,
 * the loader's per-domain first-TIMELINE_SNAPSHOT_LIMIT window, the
 * proof gate, and the ad-destination gate — then builds the same ledger
 * the /timeline/:domain page renders via buildOfferLedger. A domain with
 * zero surviving entries never yields a section. Capped at
 * SITEMAP_TIMELINE_PATH_LIMIT distinct domains, same crawl-budget ceiling
 * the sitemap uses. Kept separate from the D1 read so the gates are
 * unit-testable without a database.
 */
export function brandTimelinesFromRows(
  rows: readonly LlmsFullSnapshotRow[],
): LlmsFullBrandTimeline[] {
  const byDomain = new Map<string, LlmsFullSnapshotRow[]>();
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

  const sections: LlmsFullBrandTimeline[] = [];
  for (const [domain, bucket] of byDomain) {
    // The loader's per-domain window: only the first TIMELINE_SNAPSHOT_LIMIT
    // rows (input is ASC, matching the loader's `ORDER BY ... ASC LIMIT`).
    const window =
      bucket.length > TIMELINE_SNAPSHOT_LIMIT
        ? bucket.slice(0, TIMELINE_SNAPSHOT_LIMIT)
        : bucket;

    const snapshots = window
      .filter((row) => canonicalUrlBelongsToDomain(row.canonical_url, domain))
      // Ad-destination rows are the ad wall's surface, never the brand's own
      // dated offer (issue #1729) — same exclusion the /timeline loader uses.
      .filter((row) => !row.is_ad_destination)
      // Proof gate (issue #1284): only rows carrying BOTH stored artifacts
      // may be presented as evidence.
      .filter(snapshotRowHasCompleteProof)
      .map(rowToSnapshot);
    const entries = buildOfferLedger(snapshots);
    if (entries.length === 0) {
      continue;
    }
    const brandName = normalizeBrandPageDomain(domain)?.displayName ?? domain;
    sections.push({ domain, brandName, entries });
    if (sections.length >= SITEMAP_TIMELINE_PATH_LIMIT) {
      break;
    }
  }
  return sections;
}

/**
 * Read the bounded candidate set of snapshot rows — one SELECT, same shape
 * (and same bounded cost envelope) as the sitemap timeline read, plus the
 * offer-state columns the ledger builder needs. Read-only: never triggers
 * a live capture. Missing table on a fresh D1 degrades to [], never a 500.
 */
export async function loadLlmsFullBrandTimelines(
  env: AppEnv,
): Promise<LlmsFullBrandTimeline[]> {
  if (!env.DB) {
    return [];
  }

  try {
    const rows = await queryAll<LlmsFullSnapshotRow>(
      env,
      `
        SELECT
          id,
          canonical_url,
          captured_at,
          artifact_key,
          metadata_json,
          raw_headline,
          cta_text,
          price_text,
          form_present,
          capture_method,
          EXISTS(
            SELECT 1 FROM ad_observation ao
            WHERE ao.landing_page_snapshot_id = landing_page_snapshot.id
              AND ao.ad_id IS NOT NULL
          ) AS is_ad_destination
        FROM landing_page_snapshot
        WHERE canonical_url LIKE 'https://%' OR canonical_url LIKE 'http://%'
        ORDER BY captured_at ASC, id ASC
        LIMIT ?
      `,
      SITEMAP_TIMELINE_READ_LIMIT,
    );
    return brandTimelinesFromRows(rows);
  } catch (error) {
    if (isMissingSnapshotTableError(error)) {
      return [];
    }
    throw error;
  }
}

function isMissingSnapshotTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.toLowerCase().includes("no such table") &&
    message.includes("landing_page_snapshot")
  );
}

/** One dated offer state with its evidence links, or null when the stored
 * capture does not carry BOTH proof artifacts (never rendered unevidenced). */
function renderLlmsFullEntry(entry: OfferLedgerEntry): string | null {
  if (!entry.screenshotHref || !entry.pageTextHref) {
    return null;
  }
  const asOf = entry.capturedAt.slice(0, 10);
  const parts = [`As of ${asOf}: "${entry.headline}"`];
  if (entry.ctaText) {
    parts.push(`CTA: ${entry.ctaText}`);
  }
  if (entry.priceText) {
    parts.push(`Price: ${entry.priceText}`);
  }
  const evidence = `  Evidence: [screenshot](${canonicalUrl(entry.screenshotHref)}) · [page text](${canonicalUrl(entry.pageTextHref)})`;
  return `- ${parts.join(" — ")}\n${evidence}`;
}

/** Markdown headers the public feed serves. Shared by the worker intercept
 * and the React Router resource route so the two cannot drift. */
export const LLMS_FULL_CONTENT_TYPE = "text/markdown; charset=utf-8";
export const LLMS_FULL_CONTENT_SIGNAL =
  "search=yes, ai-input=yes, ai-train=no, use=reference";

export function llmsFullMarkdownResponse(request: Request, body: string): Response {
  return new Response(request.method === "HEAD" ? null : body, {
    headers: {
      "content-type": LLMS_FULL_CONTENT_TYPE,
      vary: "Accept",
      "content-signal": LLMS_FULL_CONTENT_SIGNAL,
    },
  });
}

/** Load the dated corpus and return the public markdown Response. Read-only:
 * never scrapes, never 500s on a missing snapshot table. */
export async function serveLlmsFullFeed(
  env: AppEnv,
  request: Request,
): Promise<Response> {
  const brandTimelines = await loadLlmsFullBrandTimelines(env);
  return llmsFullMarkdownResponse(request, buildLlmsFullText(brandTimelines));
}

/**
 * Render the full-text feed. Pure: pass the sections loadLlmsFullBrandTimelines
 * returns. Honesty gates re-applied here so the renderer alone can never
 * fabricate: empty sections are skipped, entries without both proof links
 * are skipped, and an empty corpus renders an explicit "no brand records
 * stored yet" state instead of invented content. `now` is injectable so the
 * stale labeling is deterministically testable.
 */
export function buildLlmsFullText(
  sections: readonly LlmsFullBrandTimeline[],
  now: Date = new Date(),
): string {
  const renderedSections = sections
    .filter((section) => section.entries.length > 0)
    .map((section) => renderBrandSection(section, now));
  const body =
    renderedSections.length > 0
      ? renderedSections.join("\n")
      : "No brand records stored yet. A brand appears here only once a complete proof capture (screenshot + page text) is stored.\n";

  return `# Five to Nine full-text brand record

Dated offer states and proof captures for tracked brands, generated read-only from the same stored evidence the /timeline/:domain pages render. Every "As of" date is the UTC date the capture was taken, and every state links its stored screenshot and page-text evidence. Nothing here is synthesized: a brand appears only when a complete proof capture exists, and stale proof is labeled with its capture age.

${body}
`;
}

function renderBrandSection(
  section: LlmsFullBrandTimeline,
  now: Date,
): string {
  const newest = section.entries[section.entries.length - 1];
  const freshnessLines: string[] = [];
  if (newest) {
    const checkedAgo = formatBrandPageCheckedAgo(newest.capturedAt, now);
    const ageMs = now.getTime() - Date.parse(newest.capturedAt);
    const stale =
      !Number.isFinite(ageMs) || ageMs > BRAND_PAGE_FRESH_FOR_INDEXING_MS;
    freshnessLines.push(
      `- Evidence freshness: captured ${checkedAgo}${stale ? " — STALE (older than the 7-day freshness window 0509's indexable surfaces use; verify against the linked capture dates)" : ""}`,
    );
  }

  const entries = section.entries
    .map(renderLlmsFullEntry)
    .filter((line): line is string => line !== null);

  return [
    `## ${section.domain}`,
    "",
    `- Offer timeline: ${canonicalUrl(`/timeline/${section.domain}`)}`,
    `- Meta ads page: ${canonicalUrl(`/ads/${section.domain}`)}`,
    "- Offer source: Meta Ad Library via public search, with landing-page captures stored by Five to Nine monitoring",
    ...freshnessLines,
    "",
    "Dated offer states:",
    "",
    ...(entries.length > 0
      ? entries
      : ["- No fully-evidenced offer state stored for this brand yet."]),
    "",
  ].join("\n");
}
