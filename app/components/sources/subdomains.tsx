import type { SourceSnapshotRecord, SourceChange } from "~/lib/sources/types";

/**
 * New web addresses (subdomains via crt.sh) source section — STUB (seam
 * #2218). Renders nothing until #2198 replaces this file with the real
 * section.
 */
export function SubdomainsSection({
  snapshot: _snapshot,
  diff: _diff,
}: {
  snapshot: SourceSnapshotRecord | null;
  diff: SourceChange[];
}) {
  return null;
}
