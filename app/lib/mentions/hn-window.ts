const HN_PLUGIN_KEY = "hn.algolia";

interface CursorWatch {
  hn_cursor: number;
  watch_created_at: string | null;
}

interface DatedItem {
  publishedAt: string | null;
}

function epochSeconds(iso: string | null): number | null {
  if (iso === null) return null;
  const millis = Date.parse(iso);
  return Number.isNaN(millis) ? null : Math.floor(millis / 1000);
}

function floorFor(watch: CursorWatch): number {
  return Math.max(watch.hn_cursor, epochSeconds(watch.watch_created_at) ?? 0);
}

export function startCursor(pluginKey: string, watches: readonly CursorWatch[]): string | null {
  if (pluginKey !== HN_PLUGIN_KEY || watches.length === 0) return null;
  return String(Math.min(...watches.map(floorFor)));
}

export function newestEpoch(items: readonly DatedItem[]): number | null {
  const epochs = items.map((item) => epochSeconds(item.publishedAt)).filter((epoch) => epoch !== null);
  return epochs.length === 0 ? null : Math.max(...epochs);
}

export function predatesWatch(pluginKey: string, watchCreatedAt: string | null, publishedAt: string | null): boolean {
  if (pluginKey !== HN_PLUGIN_KEY) return false;
  const created = epochSeconds(watchCreatedAt);
  const published = epochSeconds(publishedAt);
  return created !== null && published !== null && published < created;
}

export function isHnPlugin(pluginKey: string): boolean {
  return pluginKey === HN_PLUGIN_KEY;
}
