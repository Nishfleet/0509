import type { SourceAdapter, SourceChange, SourceFetchContext, SourceFetchResult, SourceSnapshotInput, SourceSnapshotRecord } from "~/lib/sources/types";
import { GoogleSearchSection } from "~/components/sources/google-search";

/**
 * Google Search source adapter — STUB (seam #2218). #2181 replaces this file
 * with the real SerpProvider + decodo adapter. The stub reports unavailable so
 * the generic runSources path stores nothing and emits nothing.
 */
export const googleSearchAdapter: SourceAdapter = {
  id: "google",
  label: "Google Search",
  kind: "search",
  implemented: false,
  cadence: "daily",
  requiresEnv: () => false,
  async fetch(_env: unknown, _competitor: SourceFetchContext): Promise<SourceFetchResult> {
    return { unavailable: true, reason: "not_implemented" };
  },
  diff(_prev: SourceSnapshotRecord | null, _next: SourceSnapshotInput): SourceChange[] {
    return [];
  },
  Section: GoogleSearchSection,
};
