import { env } from "cloudflare:workers";

const PAGE_SIZE = 200;

export interface BackupPage {
  listed: number;
  copied: number;
  present: number;
  cursor: string | null;
}

export async function copyMissingPage(cursor?: string): Promise<BackupPage> {
  const listed = await env.SNAPSHOTS.list({ cursor, limit: PAGE_SIZE });
  const totals = await listed.objects.reduce<Promise<{ copied: number; present: number }>>(
    async (pending, object) => {
      const soFar = await pending;
      if ((await env.SNAPSHOTS_BACKUP.head(object.key)) !== null) {
        return { ...soFar, present: soFar.present + 1 };
      }
      const source = await env.SNAPSHOTS.get(object.key);
      if (source === null) return soFar;
      await env.SNAPSHOTS_BACKUP.put(object.key, source.body, { httpMetadata: source.httpMetadata });
      return { ...soFar, copied: soFar.copied + 1 };
    },
    Promise.resolve({ copied: 0, present: 0 }),
  );
  return { listed: listed.objects.length, ...totals, cursor: listed.truncated ? (listed.cursor ?? null) : null };
}
