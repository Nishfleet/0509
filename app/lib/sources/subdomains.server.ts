import type { SourceAdapter, SourceChange, SourceFetchContext, SourceFetchResult, SourceSnapshotInput, SourceSnapshotRecord } from "~/lib/sources/types";
import { SubdomainsSection } from "~/components/sources/subdomains";

/**
 * New web addresses (subdomains via crt.sh) source adapter — STUB (seam
 * #2218). #2198 replaces this file with the real adapter.
 */
export const subdomainsAdapter: SourceAdapter = {
  id: "subdomains",
  label: "New web addresses",
  kind: "signal",
  implemented: false,
  cadence: "weekly",
  requiresEnv: () => false,
  async fetch(_env: unknown, _competitor: SourceFetchContext): Promise<SourceFetchResult> {
    return { unavailable: true, reason: "not_implemented" };
  },
  diff(_prev: SourceSnapshotRecord | null, _next: SourceSnapshotInput): SourceChange[] {
    return [];
  },
  Section: SubdomainsSection,
};
