/**
 * Public Offer Timeline data layer — bounded D1 reads only.
 *
 * A public `/timeline/:domain` request must NEVER trigger live scraping,
 * Browser Rendering, or any other paid operation. Snapshots already exist
 * from monitoring (#952). This module only lists them.
 */

import { queryAll } from "~/lib/data/d1.server";
import { parseJson, type JsonRecord } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import type { CaptureAttemptReasonCode } from "~/lib/capture-attempt-reason-code";
import {
  backfillEvidenceNote,
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
    .map(rowToSnapshot)
    // Proof gate (issue #1284): a public /timeline/:domain row may only show
    // a competitor state that carries BOTH a stored screenshot artifact AND a
    // stored page-text extract. A row with neither — the seeded backfill
    // (migrations 0079/0081) — used to render the public "Captured on <date>,
    // no screenshot" string, which contradicts the proof promise on the first
    // page a visitor saw. Filtering here is the mechanical guard: no consumer
    // of loadOfferTimeline (the /timeline route, the /ads shared timeline, the
    // asOf lookup) can ever receive a proof-less entry, so the string can
    // never ship and a future populate-the-timeline pass cannot reintroduce it
    // without also storing both artifacts.
    .filter(snapshotHasCompleteProof);
  const entries = buildOfferLedger(snapshots);
  return {
    entries,
    asOfState: input.asOf ? offerStateAsOf(entries, input.asOf) : null,
  };
}

function snapshotHasCompleteProof(snapshot: OfferSnapshotInput): boolean {
  return snapshot.screenshotKey !== null && snapshot.pageTextKey !== null;
}

export function isOfferTimelineShareEnabled(env: AppEnv): boolean {
  return env.PUBLIC_OFFER_TIMELINE_SHARE?.trim() !== "0";
}

/**
 * Public capture-failure visibility for `/ads/:domain` (issue #1289, accept
 * criterion #3). Loads recent non-succeeded proof captures for landing-page
 * URLs that belong to `domain`, so the public page can show "we checked this
 * URL and it did not produce an alert, here is why" — read-only, no alert.
 *
 * Bounded D1 read only; never triggers a live capture. Returns an empty list
 * when D1 is absent or the read fails (the page never 500s on this surface).
 */
export interface DomainCaptureFailure {
  id: string;
  status: "capture_failed" | "skipped_due_to_budget";
  reasonCode: CaptureAttemptReasonCode | null;
  urlChecked: string | null;
  checkedAt: string;
}

export async function loadDomainCaptureFailures(
  env: AppEnv,
  input: { domain: string; limit?: number },
): Promise<DomainCaptureFailure[]> {
  if (!env.DB) return [];
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
  const bindings = domainUrlBindings(input.domain);
  // Match proof_target.landing_page_url against the domain's URL shapes.
  // 12 LIKE/equality predicates + LIMIT = 14 bound params, well under D1's
  // 100-param cap.
  const predicates = bindings.map(() => "proof_target.landing_page_url LIKE ? ESCAPE '\\'").join(" OR ");
  try {
    const rows = await queryAll<{
      id: string;
      status: string;
      failure_code: string | null;
      skip_reason: string | null;
      capture_metadata_json: string;
      attempted_at: string;
      landing_page_url: string | null;
    }>(
      env,
      `
        SELECT
          proof_capture.id,
          proof_capture.status,
          proof_capture.failure_code,
          proof_capture.skip_reason,
          proof_capture.capture_metadata_json,
          proof_capture.attempted_at,
          proof_target.landing_page_url
        FROM proof_capture
        INNER JOIN proof_target ON proof_target.id = proof_capture.proof_target_id
        WHERE (${predicates})
          AND proof_capture.status != 'succeeded'
          AND proof_capture.status != 'pending'
        ORDER BY proof_capture.attempted_at DESC
        LIMIT ?
      `,
      ...bindings,
      limit,
    );
    const { toPublicCaptureStatus, toPublicReasonCode } = await import(
      "~/lib/capture-attempt-reason-code"
    );
    return rows
      .map((row) => {
        const metadata = parseJson<JsonRecord>(row.capture_metadata_json, {});
        const internalCode =
          row.failure_code ??
          (typeof metadata.unreadableReasonCode === "string"
            ? metadata.unreadableReasonCode
            : null) ??
          row.skip_reason ??
          null;
        const status = toPublicCaptureStatus(row.status);
        if (status === "succeeded") return null;
        return {
          id: row.id,
          status,
          reasonCode: toPublicReasonCode(internalCode),
          urlChecked: row.landing_page_url,
          checkedAt: row.attempted_at,
        } satisfies DomainCaptureFailure;
      })
      .filter((row): row is DomainCaptureFailure => row !== null);
  } catch {
    return [];
  }
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
  const screenshotKey = readScreenshotKey(metadata);
  const pageTextKey = readPageTextKey(row.artifact_key, metadata);
  return {
    id: row.id,
    canonicalUrl: row.canonical_url,
    capturedAt: row.captured_at,
    headline: row.raw_headline,
    ctaText: readNullableString(row.cta_text),
    priceText: readNullableString(row.price_text),
    formPresent: readFormPresent(row.form_present),
    screenshotKey,
    pageTextKey,
    // A backfill row (issue #968) carries no screenshot and no page text by
    // design — fabricating either would be dishonest. The proof gate above
    // (issue #1284) filters these rows out before they reach the ledger, so
    // the public timeline never presents a state without both artifacts. The
    // evidenceNote is still set for any non-public audit surface that reads
    // snapshots directly.
    evidenceNote:
      !screenshotKey && !pageTextKey && isBackfillMetadata(metadata)
        ? backfillEvidenceNote(row.captured_at)
        : null,
  };
}

function isBackfillMetadata(metadata: Record<string, unknown>): boolean {
  return metadata.backfill === true;
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
