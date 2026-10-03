import { env } from "cloudflare:test";

export const NOW = "2026-10-02T02:00:00Z";

export async function resetFeedFixtures(ids: { user: string; workspace: string; email: string }): Promise<void> {
  await env.DB.exec("DELETE FROM signal");
  await env.DB.exec("DELETE FROM snapshot");
  await env.DB.exec("DELETE FROM watch");
  await env.DB.exec("DELETE FROM page");
  await env.DB.exec("DELETE FROM entity");
  await env.DB.exec("DELETE FROM workspace");
  await env.DB.exec('DELETE FROM "user"');
  const stored = await env.SNAPSHOTS.list({ prefix: "snapshot/feed/" });
  await Promise.all(stored.objects.map((object) => env.SNAPSHOTS.delete(object.key)));
  const cached = await env.IDENTITY_CACHE.list({ prefix: "feed:" });
  await Promise.all(cached.keys.map((key) => env.IDENTITY_CACHE.delete(key.name)));

  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Owner', ?, 1, ?, ?)`,
  )
    .bind(ids.user, ids.email, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Feeds', ?, 'UTC', 1, 8, ?)`,
  )
    .bind(ids.workspace, ids.user, NOW)
    .run();
  await env.DB.prepare(
    `UPDATE source SET is_enabled = 1, config_json = '{"robots":"honoured"}' WHERE key = 'feed.rss'`,
  ).run();
}

export const seedEntity = (workspace: string, id: string, domain: string, state: "on" | "off" = "on") =>
  env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, 'competitor', ?, '{}', 'manual', ?, ?)`,
  )
    .bind(id, workspace, domain, state, NOW)
    .run();

export function rssFeed(items: readonly { id: string; title: string; date?: string }[]): string {
  const body = items
    .map(
      (item) =>
        `<item><title>${item.title}</title><link>https://rival.com/blog/${item.id}</link><guid>${item.id}</guid><pubDate>${new Date(item.date ?? "2026-09-30T10:00:00Z").toUTCString()}</pubDate><description>About ${item.title}</description></item>`,
    )
    .join("");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Rival</title>${body}</channel></rss>`;
}
