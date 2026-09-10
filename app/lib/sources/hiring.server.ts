import type { SourceAdapter, SourceChange, SourceFetchContext, SourceFetchResult, SourceSnapshotInput, SourceSnapshotRecord } from "~/lib/sources/types";
import { HiringSection } from "~/components/sources/hiring";

/**
 * Hiring (job boards) source adapter — STUB (seam #2218). #2199 replaces
 * this file with the real adapter.
 */
export const hiringAdapter: SourceAdapter = {
  id: "hiring",
  label: "Hiring",
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
  Section: HiringSection,
};
