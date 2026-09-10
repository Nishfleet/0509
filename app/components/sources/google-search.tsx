import type { SourceSnapshotRecord, SourceChange } from "~/lib/sources/types";

/**
 * Google Search source section — STUB (seam #2218). Renders nothing until
 * #2181 replaces this file with the real section. This is the only file #2181
 * edits for the section; the seam owns the slot that renders it.
 */
export function GoogleSearchSection({
  snapshot: _snapshot,
  diff: _diff,
}: {
  snapshot: SourceSnapshotRecord | null;
  diff: SourceChange[];
}) {
  return null;
}
