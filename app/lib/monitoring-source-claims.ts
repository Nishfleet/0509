/**
 * Claim-table gate for public monitoring-source copy (issue #2188).
 *
 * `docs/customer-claim-audit-table.json` is the single source of truth for
 * which competitor-monitoring sources may be named in public copy. Each seam
 * (#2218) source row carries a `monitoringSource` block; a row is claimable
 * only when `status: "live"` AND `currentResult: "pass"` — i.e. its source
 * ticket merged AND a production proof comment exists. Marketing surfaces
 * render a row per live source with the wording taken from the row's `text`
 * field, so flipping the table row is the only edit that turns a claim on.
 *
 * This module is client-safe: it imports only the audit-table JSON and never
 * a `.server` module.
 */
import claimAuditTable from "../../docs/customer-claim-audit-table.json";

export interface MonitoringSourceClaimBlock {
  sourceId: string;
  label: string;
  status: string;
  proofUrl?: string;
  proofDate?: string;
}

interface AuditClaimRow {
  claimId: string;
  text: string;
  currentResult: string;
  monitoringSource?: MonitoringSourceClaimBlock;
}

export interface LiveMonitoringSource {
  sourceId: string;
  label: string;
  /** The claim-table row wording, rendered verbatim in public copy. */
  text: string;
  proofUrl: string | null;
}

const CLAIM_ROWS = (claimAuditTable as { claims: readonly AuditClaimRow[] }).claims;

/** Every seam source row, in claim-table order, live or not. */
export function monitoringSourceClaims(): MonitoringSourceClaimBlock[] {
  return CLAIM_ROWS.flatMap((claim) =>
    claim.monitoringSource ? [claim.monitoringSource] : [],
  );
}

/** Sources whose claim-table row is live — the only ones copy may name. */
export function liveMonitoringSources(): LiveMonitoringSource[] {
  return CLAIM_ROWS.flatMap((claim) => {
    const source = claim.monitoringSource;
    if (!source || source.status !== "live" || claim.currentResult !== "pass") {
      return [];
    }
    return [
      {
        sourceId: source.sourceId,
        label: source.label,
        text: claim.text,
        proofUrl: source.proofUrl ?? null,
      },
    ];
  });
}

/** True when one source's claim-table row is live (e.g. `"google"`). */
export function isMonitoringSourceLive(sourceId: string): boolean {
  return liveMonitoringSources().some((source) => source.sourceId === sourceId);
}
