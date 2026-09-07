import { safeHttpsImageUrl } from "~/lib/change-intelligence";
import type { WatchEventRecord } from "~/lib/types";

/**
 * BL-030 — the one green mark.
 *
 * The whole system spends its accent in exactly one place per viewport: the
 * caught change, rendered as the landing's diff typography (struck old value,
 * green-filled new value). Both values are read off the stored event
 * metadata, so the mark is evidence, never decoration — an event without
 * stored before/after values simply has no mark, and the surface says what
 * happened in words instead.
 */
export interface ChangeMark {
  from: string;
  to: string;
}

const MAX_MARK_LENGTH = 48;

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Returns the mark only when BOTH sides are stored, both are short enough to
 * read as tokens rather than paragraphs, and they actually differ. A "diff"
 * whose two halves are equal is not a change, and a 400-character landing-page
 * paragraph is not a token.
 */
export function readChangeMark(event: WatchEventRecord): ChangeMark | null {
  const from = readMetadataString(event.metadata, "from");
  const to = readMetadataString(event.metadata, "to");
  if (!from || !to) return null;
  if (from === to) return null;
  if (from.length > MAX_MARK_LENGTH || to.length > MAX_MARK_LENGTH) return null;
  return { from, to };
}

/** The newest event that carries a readable mark, if any. */
export function firstChangeMark(
  events: readonly WatchEventRecord[],
): { event: WatchEventRecord; mark: ChangeMark } | null {
  for (const event of events) {
    const mark = readChangeMark(event);
    if (mark) return { event, mark };
  }
  return null;
}

/**
 * BL-030 extension — the landing-page evidence card.
 *
 * The one green mark is a token: it refuses values over 48 characters, so a
 * rewritten landing-page headline (a paragraph, not a token) currently falls
 * back to no mark at all. The card carries what the mark cannot — readable
 * long before/after values, the exact source URL, capture timestamps, the
 * changed region, and, when stored, the before/after screenshot pair. It never
 * claims screenshot proof unless BOTH artifacts are valid HTTPS image URLs.
 */
export type LandingPageProofState =
  | "screenshot_proof"
  | "proof_pending"
  | "proof_unavailable";

export interface LandingPageEvidence {
  from: string | null;
  to: string | null;
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
  sourceUrl: string | null;
  beforeCapturedAt: string | null;
  capturedAt: string | null;
  changedField: string;
  proofState: LandingPageProofState;
}

const LANDING_PAGE_CHANGED_FIELD_LABELS: Record<string, string> = {
  landing_page_url_changed: "Destination URL",
  landing_page_headline_changed: "Headline",
  landing_page_offer_changed: "Offer / price",
  landing_page_cta_changed: "Call to action",
  landing_page_form_changed: "Form state",
};

const SOURCE_URL_KEYS = [
  "sourceUrl",
  "proofUrl",
  "landingPageUrl",
  "websiteUrl",
  "websiteProofUrl",
  "canonicalUrl",
];

const BEFORE_IMAGE_KEYS = ["beforeCreativeImageUrl", "fromCreativeImageUrl"];
const AFTER_IMAGE_KEYS = ["afterCreativeImageUrl", "toCreativeImageUrl"];

export function isLandingPageEventType(eventType: string | undefined): boolean {
  return typeof eventType === "string" && eventType.startsWith("landing_page_");
}

/** The changed region in customer words, with a truthful fallback. */
export function landingPageChangedFieldLabel(eventType: string | undefined): string {
  return (eventType && LANDING_PAGE_CHANGED_FIELD_LABELS[eventType]) || "Landing page";
}

function firstMetadataString(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = readMetadataString(metadata, key);
    if (value) return value;
  }
  return null;
}

function hasAnyImageKey(metadata: Record<string, unknown> | undefined): boolean {
  return [...BEFORE_IMAGE_KEYS, ...AFTER_IMAGE_KEYS].some(
    (key) => readMetadataString(metadata, key) !== null,
  );
}

/**
 * Evidence for a landing-page change. Returns null for anything the short
 * token mark already carries (short values, no screenshots) so the card never
 * crowds the mark. proofState is screenshot_proof only when BOTH stored
 * artifact URLs validate as HTTPS images; a missing or invalid artifact is
 * proof_pending (artifact intent on file) or proof_unavailable (none stored),
 * never proof.
 */
export function readLandingPageEvidence(event: WatchEventRecord): LandingPageEvidence | null {
  if (!isLandingPageEventType(event.eventType)) return null;
  const from = readMetadataString(event.metadata, "from");
  const to = readMetadataString(event.metadata, "to");
  const beforeImageUrl = safeHttpsImageUrl(
    firstMetadataString(event.metadata, BEFORE_IMAGE_KEYS),
  );
  const afterImageUrl = safeHttpsImageUrl(
    firstMetadataString(event.metadata, AFTER_IMAGE_KEYS),
  );
  const hasLongText =
    (from?.length ?? 0) > MAX_MARK_LENGTH || (to?.length ?? 0) > MAX_MARK_LENGTH;
  if (!beforeImageUrl && !afterImageUrl && !hasLongText) return null;

  const kind = (event.metadata as Record<string, unknown> | undefined)?.kind;
  return {
    from,
    to,
    beforeImageUrl,
    afterImageUrl,
    sourceUrl: firstMetadataString(event.metadata, SOURCE_URL_KEYS),
    beforeCapturedAt: readMetadataString(event.metadata, "beforeCapturedAt"),
    capturedAt: readMetadataString(event.metadata, "capturedAt"),
    changedField:
      kind === "creative_copy"
        ? "Creative copy"
        : landingPageChangedFieldLabel(event.eventType),
    proofState:
      beforeImageUrl && afterImageUrl
        ? "screenshot_proof"
        : hasAnyImageKey(event.metadata)
          ? "proof_pending"
          : "proof_unavailable",
  };
}

/** The newest event that carries landing-page evidence the mark cannot, if any. */
export function firstLandingPageEvidence(
  events: readonly WatchEventRecord[],
): { event: WatchEventRecord; evidence: LandingPageEvidence } | null {
  for (const event of events) {
    const evidence = readLandingPageEvidence(event);
    if (evidence) return { event, evidence };
  }
  return null;
}
