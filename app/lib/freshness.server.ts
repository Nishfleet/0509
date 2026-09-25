import type { FreshnessEntry } from "../components/freshness-line";
import { sourcePillStatus, type SourceRow, type SourceSnapshot } from "../components/source-pill";
import { sourceName } from "./source-name";

export interface FreshnessSource {
  kind: string;
  source: SourceRow;
  snapshot: SourceSnapshot | null;
}

export function freshnessEntries(
  sources: readonly FreshnessSource[],
  now: number,
): readonly FreshnessEntry[] {
  const mapped: FreshnessEntry[] = [];
  for (const item of sources) {
    const status = sourcePillStatus(item.source, item.snapshot, now);
    if (status.state === "disabled") continue;
    mapped.push({
      key: item.source.key,
      name: sourceName(item.kind, item.source.platform),
      state: status.state,
      lastLandedAt:
        status.state === "degraded" ? status.lastGoodAt : (item.snapshot?.fetched_at ?? null),
      reason: status.reason,
    });
  }
  return [...mapped].sort((a, b) => a.key.localeCompare(b.key));
}

export function blindSourceNames(entries: readonly FreshnessEntry[]): readonly string[] {
  return entries.filter((entry) => entry.state === "degraded").map((entry) => entry.name);
}
