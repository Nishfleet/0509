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

export interface LandingPageSnapshotRow {
  id: string;
  canonical_url: string;
  raw_headline: string;
  cta_text: string | null;
  price_text: string | null;
  form_present: number | null;
  artifact_key: string | null;
  metadata_json: string | null;
  capture_method: string | null;
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
          capture_method,
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

function snapshotHasCompleteProof(
  snapshot: Pick<OfferSnapshotInput, "screenshotKey" | "pageTextKey">,
): boolean {
  return snapshot.screenshotKey !== null && snapshot.pageTextKey !== null;
}

/**
 * The loader's own proof gate on a raw `landing_page_snapshot` row (issue
 * #1284): a public timeline may only present a competitor state that carries
 * BOTH a stored screenshot artifact AND a stored page-text extract. Shared by
 * `loadOfferTimeline` and the sitemap timeline entries (sitemap.server.ts) so
 * the sitemap can never list a domain whose timeline would render a
 * proof-filtered (and therefore empty → gone/noindex) ledger.
 *
 * Only the two stored-artifact columns matter for the gate; callers with a
 * subset row (the sitemap read selects fewer columns) can use this directly.
 */
export function snapshotRowHasCompleteProof(
  row: Pick<LandingPageSnapshotRow, "artifact_key" | "metadata_json">,
): boolean {
  const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
  const screenshotKey = readScreenshotKey(metadata);
  const pageTextKey = readPageTextKey(row.artifact_key, metadata);
  return snapshotHasCompleteProof({ screenshotKey, pageTextKey });
}

/**
 * Stored `landing_page_snapshot` rows for a domain that the proof gate
 * (issue #1284) suppresses from the public ledger: a row without BOTH a
 * screenshot artifact and a page-text extract must never be presented as
 * evidence. The MCP `list_suppressed` tool exposes these rows so an agent
 * can see they exist but must not be cited.
 *
 * Bounded D1 read only; never triggers a live capture. Returns [] when D1 is
 * absent or the table is missing (the read surface never 500s).
 */
export interface SuppressedOfferTimelineRow {
  id: string;
  canonicalUrl: string;
  capturedAt: string;
  reason: string;
}

export async function loadSuppressedOfferTimelineRows(
  env: AppEnv,
  input: { domain: string; limit?: number },
): Promise<SuppressedOfferTimelineRow[]> {
  if (!env.DB) {
    return [];
  }
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
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
          capture_method,
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
      limit,
    );
  } catch (error) {
    if (isMissingSnapshotTable(error)) {
      return [];
    }
    throw error;
  }

  return rows
    .filter((row) => canonicalUrlBelongsToDomain(row.canonical_url, input.domain))
    .filter((row) => !snapshotRowHasCompleteProof(row))
    .map((row) => ({
      id: row.id,
      canonicalUrl: row.canonical_url,
      capturedAt: row.captured_at,
      reason: suppressionReason(row),
    }));
}

function suppressionReason(row: LandingPageSnapshotRow): string {
  const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
  const hasScreenshot = readScreenshotKey(metadata) !== null;
  const hasPageText = readPageTextKey(row.artifact_key, metadata) !== null;
  if (!hasScreenshot && !hasPageText) {
    return isBackfillMetadata(metadata)
      ? "seeded backfill row with no screenshot or page-text artifact"
      : "no screenshot or page-text artifact stored";
  }
  if (!hasScreenshot) {
    return "no screenshot artifact stored";
  }
  return "no page-text artifact stored";
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

/**
 * A server-rendered summary of a domain's capture failures — the public
 * `/ads/:domain` page renders this instead of leaking the full
 * `captureFailures` array into the loader data (issue #1345, accept #3).
 *
 * The full per-entry list is lazy-loaded on expand via the
 * `api.ads.capture-failures.$domain` endpoint; the loader ships only the
 * count, the date range, and the most recent reason code so a buyer who
 * opens DevTools sees a dated, accountable summary — not a raw skip list.
 */
export interface CaptureFailuresSummary {
  /** Total number of failed/skipped captures on record for this domain. */
  count: number;
  /** Earliest `checkedAt` in the set (ISO 8601), or null for a single entry. */
  earliestDate: string | null;
  /** Latest `checkedAt` in the set (ISO 8601). */
  latestDate: string;
  /** Reason code of the most recent entry (may be null if unclassifiable). */
  reasonCode: CaptureAttemptReasonCode | null;
  /** True when at least one entry is a `skipped_due_to_budget` capture. */
  hasSkippedDueToBudget: boolean;
}

/**
 * Reduce a `DomainCaptureFailure[]` to a `CaptureFailuresSummary`. Returns
 * `null` when the input is empty (the page hides the section in that case).
 *
 * The entries are sorted `DESC` by `checkedAt` by `loadDomainCaptureFailures`,
 * so `failures[0]` is the most recent — but this function does not rely on
 * that ordering; it scans the full array to be robust against a caller that
 * passes an unsorted list.
 */
export function summarizeDomainCaptureFailures(
  failures: DomainCaptureFailure[],
): CaptureFailuresSummary | null {
  if (failures.length === 0) return null;
  let earliest = failures[0]!.checkedAt;
  let latest = failures[0]!.checkedAt;
  let hasSkippedDueToBudget = false;
  for (const failure of failures) {
    if (failure.checkedAt < earliest) earliest = failure.checkedAt;
    if (failure.checkedAt > latest) latest = failure.checkedAt;
    if (failure.status === "skipped_due_to_budget") hasSkippedDueToBudget = true;
  }
  // The most recent entry is the one with the latest checkedAt.
  const mostRecent = failures.find((f) => f.checkedAt === latest) ?? failures[0]!;
  return {
    count: failures.length,
    earliestDate: failures.length > 1 ? earliest : null,
    latestDate: latest,
    reasonCode: mostRecent.reasonCode,
    hasSkippedDueToBudget,
  };
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
    captureMethod: row.capture_method,
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
