import type { SourceChange, SourceSnapshotInput, SourceSnapshotRecord } from "~/lib/sources/types";
import type { JsonRecord } from "~/lib/data/helpers.server";
import type { SubdomainName } from "~/lib/sources/subdomains/subdomain-signals.server";

/**
 * Snapshot payload + diff for the subdomains source — issue #2198.
 *
 * The adapter's `fetch` returns a `SubdomainSnapshotPayload` as its
 * `SourceSnapshotInput.payload`. The adapter's `diff` delegates here.
 *
 * Per the judge edit (batch 2): `diff()` returns SourceChange[] only for
 * new public names and [] on a first (baseline) snapshot. Internal names
 * live in the payload, never in diff output.
 */

export interface SubdomainSnapshotPayload extends JsonRecord {
  domain: string;
  names: SubdomainName[];
  truncated: boolean;
  unavailable?: false;
}

/**
 * Extract a typed payload from a stored snapshot record. Returns null when
 * the stored payload does not match the subdomains shape.
 */
export function parseSubdomainPayload(
  record: SourceSnapshotRecord | null,
): SubdomainSnapshotPayload | null {
  if (!record) return null;
  const payload = record.payload as Partial<SubdomainSnapshotPayload>;
  if (
    typeof payload?.domain !== "string" ||
    !Array.isArray(payload?.names)
  ) {
    return null;
  }
  return payload as SubdomainSnapshotPayload;
}

/**
 * Diff previous vs next subdomain snapshots. Returns one SourceChange per
 * new public name that was NOT in the previous snapshot.
 *
 * - First snapshot (prev is null): returns [] (baseline — never alerts).
 * - Internal names: stored in the payload, never in diff output.
 * - Unavailable next: returns [] (the run path already skips unavailable).
 */
export function diffSubdomainSnapshots(
  prev: SourceSnapshotRecord | null,
  next: SourceSnapshotInput,
): SourceChange[] {
  const prevPayload = parseSubdomainPayload(prev);
  const nextPayload = next.payload as Partial<SubdomainSnapshotPayload>;

  if (!nextPayload || !Array.isArray(nextPayload.names)) {
    return [];
  }

  // Baseline: no previous snapshot → never alert.
  if (!prevPayload) {
    return [];
  }

  const prevNames = new Set(prevPayload.names.map((n) => n.name));

  const changes: SourceChange[] = [];
  for (const entry of nextPayload.names) {
    if (entry.kind !== "public") continue;
    if (prevNames.has(entry.name)) continue;
    changes.push({
      eventType: "website_page_added",
      title: `New web address: ${entry.name}`,
      summary: `Certificate Transparency log shows a new public subdomain "${entry.name}" for ${nextPayload.domain ?? "this competitor"}. A new address often means a new product surface is being built.`,
      metadata: {
        subdomain: entry.name,
        firstSeen: entry.firstSeen,
        kind: "public",
      },
    });
  }

  return changes;
}
