/**
 * Issue #2175 — THE CHANGE BRIEF THAT SELLS.
 *
 * Shared per-change brief facts for the two customer email surfaces that
 * carry change rows (instant alerts in `delivery.server.ts`, digest top
 * moves in `digest-email.server.ts`). Every change row answers the same five
 * questions from stored facts only — what changed (the mark), when (both
 * capture timestamps), proof (screenshot pair or the honest reason none is
 * shown), how critical (band + reasons), and what it usually means (one
 * deterministic line per change type, no LLM).
 *
 * Honesty contract: nothing here invents a value. The mark renders only when
 * both sides are stored tokens that differ; capture times render only when
 * stored and ordered; a missing screenshot always names why; criticality
 * reads the monitor's own stored band when present and otherwise runs the
 * shared scorer (`change-criticality.server.ts`, read-only) on the stored
 * before/after values.
 */

import {
  scoreChangeCriticality,
  type CriticalityBand,
} from "~/lib/change-criticality.server";
import { safeTimeZone } from "~/lib/safe-timezone";

export interface ChangeBriefFactInput {
  eventType?: string | null;
  metadata?: Record<string, unknown> | null;
  title?: string | null;
}

// ---------------------------------------------------------------------------
// The change mark (BL-030 token rule, mirrored from change-mark.ts): both
// sides stored, both short enough to read as tokens, and actually different.
// ---------------------------------------------------------------------------

export interface ChangeBriefMark {
  from: string;
  to: string;
}

const MAX_MARK_LENGTH = 48;

export function readChangeBriefMark(
  input: ChangeBriefFactInput,
): ChangeBriefMark | null {
  const from = readFactString(input.metadata?.from);
  const to = readFactString(input.metadata?.to);
  if (!from || !to) return null;
  if (from === to) return null;
  if (from.length > MAX_MARK_LENGTH || to.length > MAX_MARK_LENGTH) return null;
  return { from, to };
}

// ---------------------------------------------------------------------------
// Criticality band + reasons. Website-page events carry the monitor's own
// stored band/reasons (competitor-site-monitor.server.ts); every other change
// is scored here from its stored before/after values with the shared scorer.
// ---------------------------------------------------------------------------

export interface ChangeBriefCriticality {
  /** Null when the scorer found no signal at all — the honest "not scored". */
  band: CriticalityBand | null;
  bandLabel: string;
  score: number | null;
  reasonLabels: string[];
}

const CRITICALITY_BAND_LABELS: Record<CriticalityBand, string> = {
  cosmetic: "Cosmetic",
  routine: "Routine",
  material: "Material",
  critical: "Critical",
};

const CRITICALITY_REASON_LABELS: Record<string, string> = {
  "new-landing-page": "new landing page appeared",
  "page-removed": "a tracked page was removed",
  "cta-string-change": "the CTA text changed",
  "price-token": "price or offer terms moved",
  "asset-hash-change": "page assets changed",
  "low-text-diff-ratio": "a small text edit",
  "text-diff": "page text changed",
};

export const CHANGE_BRIEF_CRITICALITY_NOT_SCORED =
  "Not scored — no criticality signals on file for this change.";

function isCriticalityBand(value: string): value is CriticalityBand {
  return value in CRITICALITY_BAND_LABELS;
}

/** Human label for a stored reason token; unknown tokens humanize, never drop. */
export function criticalityReasonLabel(reason: string): string {
  return CRITICALITY_REASON_LABELS[reason] ?? reason.replaceAll("-", " ");
}

/** Map a digest/alert event type onto the scorer's field vocabulary. */
function scorerFieldForEventType(eventType: string | null | undefined): string | null {
  switch (eventType) {
    case "landing_page_offer_changed":
      return "offerPrice";
    case "landing_page_cta_changed":
      return "cta";
    case "landing_page_headline_changed":
      return "title";
    default:
      return null;
  }
}

function scorerKindForMetadata(
  metadata: Record<string, unknown> | null | undefined,
): "page-added" | "page-removed" | "field-changed" | "ad-copy" | "asset" | undefined {
  const kind = readFactString(metadata?.kind);
  if (
    kind === "page-added" ||
    kind === "page-removed" ||
    kind === "field-changed" ||
    kind === "ad-copy" ||
    kind === "asset"
  ) {
    return kind;
  }
  return undefined;
}

export function readChangeBriefCriticality(
  input: ChangeBriefFactInput,
): ChangeBriefCriticality {
  const metadata = input.metadata ?? {};
  // Website-page events carry the band the monitor computed at file time —
  // the stored record wins over a recompute so email and app never disagree.
  const storedBand = readFactString(metadata.criticalityBand);
  if (storedBand && isCriticalityBand(storedBand)) {
    const storedReasons = Array.isArray(metadata.criticalityReasons)
      ? metadata.criticalityReasons.filter(
          (reason): reason is string => typeof reason === "string" && reason.trim().length > 0,
        )
      : [];
    const storedScore =
      typeof metadata.priorityScore === "number" && Number.isFinite(metadata.priorityScore)
        ? metadata.priorityScore
        : null;
    return {
      band: storedBand,
      bandLabel: CRITICALITY_BAND_LABELS[storedBand],
      score: storedScore,
      reasonLabels: storedReasons.map(criticalityReasonLabel),
    };
  }

  const scored = scoreChangeCriticality({
    kind: scorerKindForMetadata(metadata),
    field: scorerFieldForEventType(input.eventType),
    before: readFactString(metadata.from),
    after: readFactString(metadata.to),
    assetHashChanged: metadata.assetHashChanged === true,
  });
  if (scored.reasons.length === 0) {
    return {
      band: null,
      bandLabel: "Not scored",
      score: null,
      reasonLabels: [],
    };
  }
  return {
    band: scored.band,
    bandLabel: CRITICALITY_BAND_LABELS[scored.band],
    score: scored.score,
    reasonLabels: scored.reasons.map(criticalityReasonLabel),
  };
}

/** One-line criticality summary shared by the HTML and text brief rows. */
export function changeBriefCriticalityLine(criticality: ChangeBriefCriticality): string {
  if (!criticality.band) {
    return `Criticality: ${CHANGE_BRIEF_CRITICALITY_NOT_SCORED}`;
  }
  const score =
    criticality.score === null ? "" : ` (${Math.round(criticality.score)}/100)`;
  const reasons =
    criticality.reasonLabels.length > 0 ? ` — ${criticality.reasonLabels.join("; ")}` : "";
  return `Criticality: ${criticality.bandLabel}${score}${reasons}`;
}

// ---------------------------------------------------------------------------
// "What this usually means" — one deterministic interpretation line per
// change type. No LLM, no invented specifics: the line names the general
// meaning of the change class, never facts not on file.
// ---------------------------------------------------------------------------

export function changeBriefMeaningLine(input: ChangeBriefFactInput): string {
  const kind = readFactString(input.metadata?.kind);
  if (kind === "baseline") {
    return "This is the starting snapshot — future changes are measured against it.";
  }
  if (kind === "creative_copy") {
    return "A rewritten creative usually means a new hook or angle is being tested.";
  }
  if (kind === "ad_new_aggregate") {
    return "Several new ads at once usually means a fresh campaign push.";
  }
  switch (input.eventType) {
    case "landing_page_offer_changed":
      return "An offer or price move usually means new discount pressure on your positioning.";
    case "landing_page_cta_changed":
      return "A CTA change usually means the competitor is pushing a different next step — purchase, signup, or lead capture.";
    case "landing_page_headline_changed":
      return "A headline change usually means new positioning or a new angle is being tested.";
    case "landing_page_url_changed":
      return "A destination change usually means ad traffic is being pointed at a new page or funnel.";
    case "landing_page_form_changed":
      return "A form change usually means a lead-capture step was added, removed, or simplified.";
    case "ad_new":
      return "A new ad usually means a fresh campaign, angle, or offer is being tested.";
    case "ad_inactive":
      return "A stopped ad usually means a campaign ended, budget moved, or a replacement is coming.";
    case "website_page_added":
      return "A new page usually means a new product, offer, or funnel angle worth a look.";
    case "website_page_removed":
      return "A removed page usually means an offer, pricing, or funnel step moved or was retired.";
    case "website_page_changed":
      return "A changed page usually means positioning, pricing, or funnel content moved.";
    default:
      return "A tracked change usually means the competitor is iterating on something worth a look.";
  }
}

// ---------------------------------------------------------------------------
// The honest no-screenshot line. Rendered only when no before/after
// screenshot pair (and no creative image) is shown for the row — the reason
// is derived from the row's own proof state, never invented.
// ---------------------------------------------------------------------------

export function changeBriefNoScreenshotReason(input: {
  eventType?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Customer proof status from the shared classification, when computed. */
  proofStatus?: string | null;
  /** True when the change is still provisional/unconfirmed. */
  provisional?: boolean;
}): string {
  const kind = readFactString(input.metadata?.kind);
  if (kind === "baseline") {
    return "No before screenshot — this is the first captured state.";
  }
  if (input.eventType === "ad_new" || input.eventType === "ad_inactive") {
    return "No page screenshot — ad changes are tracked from the ad library, not page captures.";
  }
  if (input.provisional || input.proofStatus === "needs_review") {
    return "No screenshot yet — this change is still unconfirmed.";
  }
  if (input.proofStatus === "proof_pending") {
    return "No screenshot yet — the proof capture is still pending.";
  }
  if (input.proofStatus === "proof_failed") {
    return "No screenshot captured — the proof capture did not complete.";
  }
  if (input.proofStatus === "verified_proof") {
    return "No screenshot captured — the stored proof has no screenshot artifact on file.";
  }
  return "No screenshot stored — the scheduled scan recorded this change without a page capture.";
}

// ---------------------------------------------------------------------------
// Capture timestamps for both sides of the change. Both must be stored,
// parseable, and ordered (before strictly earlier than now) — a corrupt or
// half-missing pair renders nothing rather than a misleading timeline.
// ---------------------------------------------------------------------------

export interface ChangeBriefCaptureTimes {
  beforeCapturedAt: string;
  nowCapturedAt: string;
}

const BEFORE_CAPTURE_KEYS = [
  "beforeCapturedAt",
  "fromCapturedAt",
  "previousCapturedAt",
  "baselineCapturedAt",
] as const;

const NOW_CAPTURE_KEYS = ["capturedAt", "nowCapturedAt"] as const;

function readFirstFactString(
  metadata: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = readFactString(metadata?.[key]);
    if (value) return value;
  }
  return null;
}

export function readChangeBriefCaptureTimes(
  metadata: Record<string, unknown> | null | undefined,
): ChangeBriefCaptureTimes | null {
  const beforeCapturedAt = readFirstFactString(metadata, BEFORE_CAPTURE_KEYS);
  const nowCapturedAt = readFirstFactString(metadata, NOW_CAPTURE_KEYS);
  if (!beforeCapturedAt || !nowCapturedAt) return null;
  const beforeMs = Date.parse(beforeCapturedAt);
  const nowMs = Date.parse(nowCapturedAt);
  if (!Number.isFinite(beforeMs) || !Number.isFinite(nowMs) || beforeMs >= nowMs) {
    return null;
  }
  return { beforeCapturedAt, nowCapturedAt };
}

/** "18 Apr 2026, 09:12 UTC" — viewer timezone when one is on file, else UTC. */
export function formatChangeBriefTime(
  value: string,
  timeZone?: string | null,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "time unavailable";
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
    timeZone: safeTimeZone(timeZone),
  }).format(date);
}

// ---------------------------------------------------------------------------
// Change-led subject lines (issue #2175, do-step 2): the subject leads with
// the single most critical change — competitor, what moved, and when it was
// captured — never a count. Every component is sanitized for header safety.
// ---------------------------------------------------------------------------

export function changeBriefLeadPhrase(input: ChangeBriefFactInput): string {
  const mark = readChangeBriefMark(input);
  switch (input.eventType) {
    case "landing_page_offer_changed":
      return mark ? `changed the offer to ${mark.to}` : "changed a landing page offer";
    case "landing_page_cta_changed":
      return mark ? `changed the CTA to ${mark.to}` : "changed a landing page CTA";
    case "landing_page_headline_changed":
      return mark ? `changed the headline to ${mark.to}` : "rewrote a landing page headline";
    case "landing_page_url_changed":
      return "changed a landing page destination";
    case "landing_page_form_changed":
      return "changed a landing page form";
    case "ad_new":
      return "launched a new ad";
    case "ad_inactive":
      return "stopped running an ad";
    case "website_page_added":
      return "added a new tracked page";
    case "website_page_removed":
      return "removed a tracked page";
    case "website_page_changed":
      return "changed a tracked page";
    default: {
      const title = readFactString(input.title);
      return title ? `: ${title}` : "made a change worth seeing";
    }
  }
}

/**
 * The change's own capture time for the subject suffix, e.g.
 * " — captured 09:12 IST". Reads only stored timestamps; an absent or
 * unparseable timestamp drops the suffix rather than fabricating one.
 */
export function changeBriefCapturedSuffix(
  metadata: Record<string, unknown> | null | undefined,
  timeZone?: string | null,
  fallbackCapturedAt?: string | null,
): string {
  const captured =
    readFactString(metadata?.capturedAt) ??
    readFactString(metadata?.confirmedAt) ??
    readFactString(metadata?.createdAt) ??
    readFactString(fallbackCapturedAt);
  if (!captured) return "";
  const date = new Date(captured);
  if (Number.isNaN(date.getTime())) return "";
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
    timeZone: safeTimeZone(timeZone),
  }).format(date);
  return ` — captured ${time}`;
}

export function buildChangeLeadSubject(input: {
  competitor: string;
  eventType?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
  timeZone?: string | null;
  /**
   * Event-record capture time (e.g. WatchEventRecord.confirmedAt) used when
   * the metadata carries no timestamp of its own — instant-alert events keep
   * their capture fact on the record, not in metadata.
   */
  capturedAtFallback?: string | null;
}): string {
  const competitor = sanitizeSubjectToken(input.competitor) || "A tracked competitor";
  const phrase = changeBriefLeadPhrase(input);
  const suffix = changeBriefCapturedSuffix(
    input.metadata,
    input.timeZone,
    input.capturedAtFallback,
  );
  return sanitizeEmailSubjectLine(`${competitor} ${phrase}${suffix}`);
}

/** Strip header-unsafe characters and bound a subject token (competitor names). */
export function sanitizeSubjectToken(value: string): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > MAX_MARK_LENGTH
    ? `${normalized.slice(0, MAX_MARK_LENGTH - 1)}...`
    : normalized;
}

/** Header-safe subject line: no control characters, bounded length. */
export function sanitizeEmailSubjectLine(value: string): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 140 ? `${normalized.slice(0, 139)}...` : normalized;
}

function readFactString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
