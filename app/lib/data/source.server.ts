/**
 * The `source` registry row for this engine. Adding a source is a row plus a
 * plugin, never a migration — the registry row is therefore upserted by the
 * engine itself on first sweep, keyed by its UNIQUE(platform, kind,
 * plugin_key).
 */
import type { DataEnv } from "./entity.server";

const SITE_SOURCE = {
  key: "site.web",
  kind: "site",
  platform: "web",
  plugin_key: "browser-run",
  reliability: "best_effort",
} as const;

export interface SourceRow {
  id: string;
  key: string;
  kind: string;
  platform: string;
  plugin_key: string;
  reliability: string;
}

export async function ensureSiteSource(env: DataEnv): Promise<SourceRow> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO source (id, key, kind, platform, plugin_key, reliability) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      SITE_SOURCE.key,
      SITE_SOURCE.kind,
      SITE_SOURCE.platform,
      SITE_SOURCE.plugin_key,
      SITE_SOURCE.reliability,
    )
    .run();
  const row = await env.DB.prepare(
    "SELECT id, key, kind, platform, plugin_key, reliability FROM source WHERE platform = ? AND kind = ? AND plugin_key = ?",
  )
    .bind(SITE_SOURCE.platform, SITE_SOURCE.kind, SITE_SOURCE.plugin_key)
    .first<SourceRow>();
  if (!row) throw new Error("site source row missing after upsert");
  return row;
}
