import { env } from "cloudflare:workers";

const PAGE_SIZE = 200;
const WATCH_OBJECT_KEY = /^snapshot\/(?:site|hiring|feed)\/([^/]+)\//;

export interface BackupPage {
  listed: number;
  copied: number;
  present: number;
  skipped: number;
  cursor: string | null;
}

function belongsToFixture(key: string, fixtureWatchIds: ReadonlySet<string>): boolean {
  const watchId = WATCH_OBJECT_KEY.exec(key)?.[1];
  return watchId !== undefined && fixtureWatchIds.has(watchId);
}

export async function copyMissingPage(cursor?: string, fixtureWatchIds: readonly string[] = []): Promise<BackupPage> {
  const skip = new Set(fixtureWatchIds);
  const listed = await env.SNAPSHOTS.list({ cursor, limit: PAGE_SIZE });
  const totals = await listed.objects.reduce<Promise<{ copied: number; present: number; skipped: number }>>(
    async (pending, object) => {
      const soFar = await pending;
      if (belongsToFixture(object.key, skip)) return { ...soFar, skipped: soFar.skipped + 1 };
      if ((await env.SNAPSHOTS_BACKUP.head(object.key))?.size === object.size) {
        return { ...soFar, present: soFar.present + 1 };
      }
      const source = await env.SNAPSHOTS.get(object.key);
      if (source === null) return soFar;
      await env.SNAPSHOTS_BACKUP.put(object.key, source.body, { httpMetadata: source.httpMetadata });
      if ((await env.SNAPSHOTS.head(object.key)) === null) {
        await env.SNAPSHOTS_BACKUP.delete(object.key);
        return soFar;
      }
      return { ...soFar, copied: soFar.copied + 1 };
    },
    Promise.resolve({ copied: 0, present: 0, skipped: 0 }),
  );
  return { listed: listed.objects.length, ...totals, cursor: listed.truncated ? (listed.cursor ?? null) : null };
}
