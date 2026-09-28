import { shortUtc } from "../short-utc";
import { sourceName } from "../source-name";

export const BLIND_REASON = "captured nothing for two ticks";

export interface SourceTick {
  sourceId: string;
  sourceKey: string;
  kind: string;
  platform: string;
  watchId: string;
  fetchedAt: string;
  itemCount: number;
}

export interface BlindSource {
  sourceId: string;
  sourceKey: string;
  name: string;
  lastGoodAt: string | null;
}

interface SourceGroup {
  key: string;
  kind: string;
  platform: string;
  watches: Map<string, SourceTick[]>;
}

const byFetchedAtDesc = (a: SourceTick, b: SourceTick): number =>
  Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt);

export function blindSources(
  ticks: readonly SourceTick[],
  lastGood: ReadonlyMap<string, string>,
): readonly BlindSource[] {
  const bySource = new Map<string, SourceGroup>();
  for (const tick of ticks) {
    const source = bySource.get(tick.sourceId) ?? {
      key: tick.sourceKey,
      kind: tick.kind,
      platform: tick.platform,
      watches: new Map<string, SourceTick[]>(),
    };
    bySource.set(tick.sourceId, source);
    const watch = source.watches.get(tick.watchId) ?? [];
    watch.push(tick);
    source.watches.set(tick.watchId, watch);
  }

  const blind: BlindSource[] = [];
  for (const [sourceId, source] of bySource) {
    const kept: SourceTick[] = [];
    let twoTickWatch = false;
    for (const watch of source.watches.values()) {
      const latest = [...watch].sort(byFetchedAtDesc).slice(0, 2);
      if (latest.length === 2) twoTickWatch = true;
      kept.push(...latest);
    }
    if (!twoTickWatch) continue;
    if (!kept.every((tick) => tick.itemCount === 0)) continue;
    blind.push({
      sourceId,
      sourceKey: source.key,
      name: sourceName(source.kind, source.platform),
      lastGoodAt: lastGood.get(sourceId) ?? null,
    });
  }

  return blind.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
}

export function blindAlertId(sourceId: string, workspaceId: string, now: Date): string {
  return `source-blind-${sourceId}-${workspaceId}-${now.toISOString().slice(0, 10)}`;
}

export function blindAlertText(source: BlindSource): { title: string; body: string } {
  return {
    title: `${source.name} captured nothing for two ticks`,
    body: `Last capture with items: ${source.lastGoodAt === null ? "never" : shortUtc(source.lastGoodAt)}. Nothing was removed from your brief.`,
  };
}
