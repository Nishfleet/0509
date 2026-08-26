/**
 * Public Offer Timeline data layer — bounded D1 reads only.
 *
 * A public `/timeline/:domain` request must NEVER trigger live scraping,
 * Browser Rendering, or any other paid operation. Snapshots already exist
 * from monitoring (#952). This module only lists them.
 */

import { queryAll } from "~/lib/data/d1.server";
import { parseJson } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import {
  buildOfferLedger,
  canonicalUrlBelongsToDomain,
  offerStateAsOf,
  type OfferLedgerEntry,
  type OfferSnapshotInput,
} from "~/lib/offer-timeline";
import { isValidProofPageTextKey } from "~/lib/proof-page-text";
import { isValidProofScreenshotKey } from "~/lib/proof-screenshot";

const TIMELINE_SNAPSHOT_LIMIT = 200;

interface LandingPageSnapshotRow {
  id: string;
  canonical_url: string;
  raw_headline: string;
  cta_text: string | null;
  price_text: string | null;
  form_present: number | null;
  artifact_key: string | null;
  metadata_json: string | null;
  captured_at: string;
}

export interface OfferTimelineLoad {
  entries: OfferLedgerEntry[];
  asOfState: OfferLedgerEntry | null;
}

export async function loadOfferTimeline(
  env: AppEnv,
  input: { domain: string; asOf: string | null },
): Promise<OfferTimelineLoad> {
  if (!env.DB) {
    return { entries: [], asOfState: null };
  }

  let rows: LandingPageSnapshotRow[] = [];
  try {
    rows = await queryAll<LandingPageSnapshotRow>(
      env,
      `
        SELECT
          id,
          canonical_url,
          raw_headline,
          cta_text,
          price_text,
          form_present,
          artifact_key,
          metadata_json,
          captured_at
        FROM landing_page_snapshot
        WHERE
          canonical_url = ?
          OR canonical_url = ?
          OR canonical_url = ?
          OR canonical_url = ?
          OR canonical_url LIKE ? ESCAPE '\\'
          OR canonical_url LIKE ? ESCAPE '\\'
          OR canonical_url LIKE ? ESCAPE '\\'
          OR canonical_url LIKE ? ESCAPE '\\'
          OR canonical_url LIKE ? ESCAPE '\\'
          OR canonical_url LIKE ? ESCAPE '\\'
          OR canonical_url LIKE ? ESCAPE '\\'
          OR canonical_url LIKE ? ESCAPE '\\'
        ORDER BY captured_at ASC, id ASC
        LIMIT ?
      `,
      ...domainUrlBindings(input.domain),
      TIMELINE_SNAPSHOT_LIMIT,
    );
  } catch (error) {
    if (isMissingSnapshotTable(error)) {
      return { entries: [], asOfState: null };
    }
    throw error;
  }

  const snapshots = rows
    .filter((row) => canonicalUrlBelongsToDomain(row.canonical_url, input.domain))
    .map(rowToSnapshot);
  const entries = buildOfferLedger(snapshots);
  return {
    entries,
    asOfState: input.asOf ? offerStateAsOf(entries, input.asOf) : null,
  };
}

export function isOfferTimelineShareEnabled(env: AppEnv): boolean {
  return env.PUBLIC_OFFER_TIMELINE_SHARE?.trim() !== "0";
}

function domainUrlBindings(domain: string): string[] {
  const host = domain.toLowerCase();
  const www = `www.${host}`;
  const wildcard = `%.${escapeLike(host)}`;
  const exact = escapeLike(host);
  const exactWww = escapeLike(www);
  return [
    `https://${host}`,
    `http://${host}`,
    `https://${www}`,
    `http://${www}`,
    `https://${exact}/%`,
    `http://${exact}/%`,
    `https://${exactWww}/%`,
    `http://${exactWww}/%`,
    `https://${wildcard}/%`,
    `http://${wildcard}/%`,
    `https://${wildcard}`,
    `http://${wildcard}`,
  ];
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function rowToSnapshot(row: LandingPageSnapshotRow): OfferSnapshotInput {
  const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
  return {
    id: row.id,
    canonicalUrl: row.canonical_url,
    capturedAt: row.captured_at,
    headline: row.raw_headline,
    ctaText: readNullableString(row.cta_text),
    priceText: readNullableString(row.price_text),
    formPresent: readFormPresent(row.form_present),
    screenshotKey: readScreenshotKey(metadata),
    pageTextKey: readPageTextKey(row.artifact_key, metadata),
  };
}

function readNullableString(value: string | null): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

function readFormPresent(value: number | null): boolean | null {
  if (value === 1) {
    return true;
  }
  if (value === 0) {
    return false;
  }
  return null;
}

function readScreenshotKey(metadata: Record<string, unknown>): string | null {
  const value = metadata.screenshotArtifactKey;
  if (typeof value !== "string" || !isValidProofScreenshotKey(value)) {
    return null;
  }
  return value;
}

function readPageTextKey(
  artifactKey: string | null,
  metadata: Record<string, unknown>,
): string | null {
  if (artifactKey && isValidProofPageTextKey(artifactKey)) {
    return artifactKey;
  }
  const fromMeta = metadata.htmlArtifactKey;
  if (typeof fromMeta === "string" && isValidProofPageTextKey(fromMeta)) {
    return fromMeta;
  }
  return null;
}

function isMissingSnapshotTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("no such table") && message.includes("landing_page_snapshot");
}
