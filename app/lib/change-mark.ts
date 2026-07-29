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
