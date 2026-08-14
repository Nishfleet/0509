import { digestReviewerLabel } from "~/lib/change-intelligence";
import type {
  DigestItemRecord,
  DigestRecord,
  WatchEventRecord,
} from "~/lib/types";

/**
 * Brief-as-retention-loop (lane 1, 2026-08-14): every customer-facing brief
 * (dashboard Market Desk Brief, weekly digest email, /app/digests detail)
 * must carry four explicit retention fields so the customer can answer four
 * questions from a single screen without hunting through the workspace:
 *
 *   1. What changed since the previous brief? (material delta)
 *   2. Who is accountable for acting on it? (owner)
 *   3. How strong is the signal behind it? (confidence)
 *   4. When does this verdict become stale? (expiry)
 *
 * The four fields are derived from data the orchestrator already has — the
 * filed event set, the previous digest record (when one exists), the proof
 * mix, and the next scheduled scan — never invented from text. A missing
 * upstream input renders an explicit "no prior brief on file" / "Confidence
 * unavailable" / "Expiry unset" line so the brief never silently drops the
 * field and never fabricates one.
 */

export type BriefRetentionConfidence = "high" | "medium" | "low" | "unavailable";

export interface BriefRetentionInput {
  /** The filed events or digest items in this period. */
  items?: ReadonlyArray<DigestItemRecord | WatchEventRecord> | null;
  /** The previous brief on file (the most recent digest older than this one). */
  previousBrief?: DigestRecord | null;
  /** The workspace owner / recipient identity; never invented from event text. */
  ownerName?: string | null;
  /**
   * ISO timestamp for the next scheduled check after this brief. When the
   * workspace has no next check scheduled yet, pass `null` and the expiry
   * field renders the explicit unavailable state.
   */
  nextScanAt?: string | null;
  /** Optional human-readable label for the next scan (e.g. "Monday 03:00 UTC"). */
  nextScanLabel?: string | null;
  /**
   * When true, the source access is degraded or unavailable, so confidence
   * is downgraded to reflect the missing proof pipeline.
   */
  sourceDegraded?: boolean | null;
}

export interface BriefRetentionFields {
  /** One-line statement of what changed since the previous brief. */
  delta: string;
  /** Accountable reviewer (workspace owner name or the truthful fallback). */
  owner: string;
  /** Signal strength behind the brief. */
  confidence: BriefRetentionConfidence;
  /** One-line customer-facing confidence label. */
  confidenceLabel: string;
  /** When this brief becomes stale (next scheduled scan or explicit unavailable). */
  expiry: string;
  /** Whether every retention field carries truthful content (no unavailable values). */
  hasAllFields: boolean;
}

const CONFIDENCE_UNAVAILABLE = "Confidence unavailable — no filed events on this brief.";

export function deriveBriefRetentionFields(
  input: BriefRetentionInput,
): BriefRetentionFields {
  return {
    delta: deriveBriefDelta(input),
    owner: deriveBriefOwner(input),
    confidence: deriveBriefConfidence(input),
    confidenceLabel: confidenceLabelFor(deriveBriefConfidence(input)),
    expiry: deriveBriefExpiry(input),
    hasAllFields: briefHasAllFields(input),
  };
}

export function deriveBriefDelta(input: BriefRetentionInput): string {
  const items = input.items ?? [];
  const itemCount = items.length;

  if (itemCount === 0) {
    return "No filed changes this period — the brief is anchored to the previous run on file.";
  }

  const previousBrief = input.previousBrief ?? null;
  if (!previousBrief) {
    return `${pluralChanges(itemCount)} filed — first brief on file, so this sets the baseline.`;
  }

  const previousCount = previousBrief.items?.length ?? 0;
  const delta = itemCount - previousCount;
  if (delta > 0) {
    return `${pluralChanges(itemCount)} filed — ${pluralChanges(delta)} more than the previous brief (${previousCount} on file).`;
  }
  if (delta < 0) {
    return `${pluralChanges(itemCount)} filed — ${pluralChanges(Math.abs(delta))} fewer than the previous brief (${previousCount} on file).`;
  }
  return `${pluralChanges(itemCount)} filed — same volume as the previous brief (${previousCount} on file).`;
}

export function deriveBriefOwner(input: BriefRetentionInput): string {
  return digestReviewerLabel(input.ownerName);
}

export function deriveBriefConfidence(
  input: BriefRetentionInput,
): BriefRetentionConfidence {
  const items = input.items ?? [];
  if (items.length === 0) {
    return "unavailable";
  }

  const proofBacked = items.filter((item) =>
    hasProofCapture(item as DigestItemRecord),
  ).length;
  const allProofBacked = proofBacked === items.length;

  if (input.sourceDegraded) {
    return "low";
  }
  if (allProofBacked) {
    return "high";
  }
  if (proofBacked > 0) {
    return "medium";
  }
  // No stored proof capture on any filed event: the signal is scan-spotted
  // only and the customer must verify the source themselves.
  return "low";
}

export function deriveBriefExpiry(input: BriefRetentionInput): string {
  const nextScanAt = input.nextScanAt ?? null;
  const nextScanLabel = input.nextScanLabel ?? null;
  if (nextScanAt && Number.isFinite(Date.parse(nextScanAt))) {
    return nextScanLabel
      ? `Expires at the next check — ${nextScanLabel}.`
      : "Expires at the next check.";
  }
  if (nextScanLabel) {
    return `Next check ${nextScanLabel} — no expiry timestamp on file yet.`;
  }
  return "Expiry unset — no next scheduled check is on file.";
}

function briefHasAllFields(input: BriefRetentionInput): boolean {
  const items = input.items ?? [];
  return (
    items.length > 0 &&
    Boolean(input.previousBrief) &&
    Boolean(input.ownerName && input.ownerName.trim()) &&
    deriveBriefConfidence(input) !== "unavailable" &&
    Boolean(input.nextScanAt && Number.isFinite(Date.parse(input.nextScanAt)))
  );
}

function confidenceLabelFor(level: BriefRetentionConfidence): string {
  switch (level) {
    case "high":
      return "High confidence — every filed change has stored proof.";
    case "medium":
      return "Medium confidence — at least one filed change is backed by stored proof.";
    case "low":
      return "Low confidence — no filed change has stored proof; verify the source before acting.";
    case "unavailable":
      return CONFIDENCE_UNAVAILABLE;
  }
}

function pluralChanges(count: number): string {
  return `${count} change${count === 1 ? "" : "s"}`;
}

function hasProofCapture(item: DigestItemRecord | WatchEventRecord): boolean {
  const metadata = (item as { metadata?: Record<string, unknown> | null }).metadata;
  if (metadata && typeof metadata === "object") {
    if (typeof metadata.proofCaptureId === "string" && metadata.proofCaptureId.trim()) {
      return true;
    }
    if (metadata.sourceStatus === "proof_backed" || metadata.sourceStatus === "verified_proof") {
      return true;
    }
  }
  const proofCaptureId = (item as { proofCaptureId?: string | null }).proofCaptureId;
  return Boolean(proofCaptureId && proofCaptureId.trim());
}

export function renderBriefRetentionHtml(fields: BriefRetentionFields): string {
  return [
    `<p style="margin: 0 0 6px;"><strong>Since last brief:</strong> ${escapeHtml(fields.delta)}</p>`,
    `<p style="margin: 0 0 6px;"><strong>Accountable reviewer:</strong> ${escapeHtml(fields.owner)}</p>`,
    `<p style="margin: 0 0 6px;"><strong>Confidence:</strong> ${escapeHtml(fields.confidenceLabel)}</p>`,
    `<p style="margin: 0;"><strong>Expiry:</strong> ${escapeHtml(fields.expiry)}</p>`,
  ].join("");
}

export function renderBriefRetentionText(fields: BriefRetentionFields): string[] {
  return [
    `Since last brief: ${fields.delta}`,
    `Accountable reviewer: ${fields.owner}`,
    `Confidence: ${fields.confidenceLabel}`,
    `Expiry: ${fields.expiry}`,
  ];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
