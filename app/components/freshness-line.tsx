import type { ReactElement } from "react";

import { shortUtc } from "../lib/short-utc";

export interface FreshnessEntry {
  key: string;
  name: string;
  state: "live" | "none" | "degraded";
  lastLandedAt: string | null;
  reason: string | null;
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
