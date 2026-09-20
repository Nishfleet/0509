import type { SourceAdapter, SourceChange, SourceFetchContext, SourceFetchResult, SourceSnapshotInput, SourceSnapshotRecord } from "~/lib/sources/types";
import type { AppEnv } from "~/lib/env.server";
import { HiringSection } from "~/components/sources/hiring";
import { fetchHiringSnapshot, diffHiring } from "~/lib/sources/hiring/hiring-snapshot.server";

/**
 * Hiring (job boards) source adapter (#2199).
 *
 * Watches a competitor's public Greenhouse / Ashby / Lever job board once per
 * week, snapshotting the open roles and alerting on new/closed roles. The
 * weekly cadence is the per-competitor 7-day gate reused from the snapshot
 * submodule. No credentials are needed (job feeds are public), so
 * `requiresEnv` always returns true — the env filter enables the source on
 * every plan that includes it (#2709: false here meant "not connected", so
 * hiring was filtered out of getEnabledSources and stuck at "coming_soon").
 */
export const hiringAdapter: SourceAdapter = {
  id: "hiring",
  label: "Hiring",
  kind: "signal",
  implemented: true,
  cadence: "weekly",
  requiresEnv: () => true,
  async fetch(env: unknown, competitor: SourceFetchContext): Promise<SourceFetchResult> {
    return fetchHiringSnapshot(env as AppEnv, competitor);
  },
  diff(prev: SourceSnapshotRecord | null, next: SourceSnapshotInput): SourceChange[] {
    return diffHiring(prev, next);
  },
  Section: HiringSection,
};