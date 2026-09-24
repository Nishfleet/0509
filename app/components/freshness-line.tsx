import type { ReactElement } from "react";

import { shortUtc } from "../lib/short-utc";
import { sourceName } from "../lib/source-name";
import { sourcePillStatus, type SourceRow, type SourceSnapshot } from "./source-pill";

export interface FreshnessSource {
  kind: string;
  source: SourceRow;
  snapshot: SourceSnapshot | null;
}

export interface FreshnessEntry {
  key: string;
  name: string;
  state: "live" | "none" | "degraded";
  lastLandedAt: string | null;
  reason: string | null;
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

export function freshnessText(entry: FreshnessEntry): string {
  if (entry.state === "degraded") {
    return `${entry.name} not answering (${entry.reason ?? "no reason recorded"}) · last good ${
      entry.lastLandedAt === null ? "never" : shortUtc(entry.lastLandedAt)
    }`;
  }
  return `${entry.name} landed ${
    entry.lastLandedAt === null ? "never" : shortUtc(entry.lastLandedAt)
  }`;
}

export function FreshnessLine({
  entries,
}: {
  entries: readonly FreshnessEntry[];
}): ReactElement | null {
  if (entries.length === 0) return null;
  return (
    <p data-home="freshness" className="font-mono text-eyebrow text-ink-soft mt-2">
      {entries.flatMap((entry, index) =>
        index === 0
          ? [<span key={entry.key} data-state={entry.state}>{freshnessText(entry)}</span>]
          : [" · ", <span key={entry.key} data-state={entry.state}>{freshnessText(entry)}</span>],
      )}
    </p>
  );
}
