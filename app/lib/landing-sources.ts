import { sourcePillStatus } from "../components/source-pill";
import type { WatchedSource } from "../components/landing/what-we-watch";

export function landingSources(entries: readonly WatchedSource[], now: number): readonly WatchedSource[] {
  const projected: WatchedSource[] = [];
  for (const entry of entries) {
    const status = sourcePillStatus(entry.source, entry.snapshot, now);
    if (status.state === "disabled") continue;
    projected.push({
      kind: entry.kind,
      snapshot: entry.snapshot,
      source: {
        key: entry.source.key,
        platform: entry.source.platform,
        name: entry.source.name ?? null,
        is_enabled: 1,
        degraded_reason: status.state === "degraded" ? status.reason : null,
        last_good_at: status.state === "degraded" ? status.lastGoodAt : null,
      },
    });
  }
  return projected;
}
