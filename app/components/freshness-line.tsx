import type { ReactElement } from "react";

import { shortUtc } from "../lib/short-utc";
import { plainSourceReason } from "../lib/source-status-words";

export interface FreshnessEntry {
  key: string;
  name: string;
  state: "live" | "none" | "degraded";
  lastLandedAt: string | null;
  reason: string | null;
}

export function freshnessText(entry: FreshnessEntry): string {
  if (entry.state === "degraded") {
    const lastUpdated = entry.lastLandedAt === null ? "" : ` · last updated ${shortUtc(entry.lastLandedAt)}`;
    return `${entry.name}: ${plainSourceReason(entry.reason)}${lastUpdated}`;
  }
  return entry.lastLandedAt === null
    ? `${entry.name}: no data yet`
    : `${entry.name}: updated ${shortUtc(entry.lastLandedAt)}`;
}

export function FreshnessLine({ entries }: { entries: readonly FreshnessEntry[] }): ReactElement | null {
  if (entries.length === 0) return null;
  return (
    <p data-home="freshness" className="mt-2 font-mono text-eyebrow text-ink-soft">
      {entries.flatMap((entry, index) =>
        index === 0
          ? [
              <span key={entry.key} data-state={entry.state}>
                {freshnessText(entry)}
              </span>,
            ]
          : [
              " · ",
              <span key={entry.key} data-state={entry.state}>
                {freshnessText(entry)}
              </span>,
            ],
      )}
    </p>
  );
}
