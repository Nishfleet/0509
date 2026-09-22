import { adapterFor } from "../sources/registry";
import { applyCanary, readSourceConfig, type SourceConfig } from "./map";

export async function runCanary(
  db: D1Database,
  sourceId: string,
  pluginKey: string,
  config: SourceConfig,
  now: Date,
): Promise<SourceConfig> {
  const today = now.toISOString().slice(0, 10);
  if (config.lastCanaryOn === today || config.canaryUrl.length === 0) return config;
  const claimed = await db
    .prepare(
      "UPDATE source SET config_json = ? WHERE id = ? AND COALESCE(json_extract(config_json, '$.lastCanaryOn'), '') != ?",
    )
    .bind(JSON.stringify({ ...config, lastCanaryOn: today, approved_cost: null }), sourceId, today)
    .run();
  if ((claimed.meta.changes ?? 0) !== 1) return { ...config, lastCanaryOn: today };
  const adapter = adapterFor(pluginKey);
  let count = 0;
  if (adapter) {
    try {
      const response = await fetch(config.canaryUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { "user-agent": "FiveToNine/1.0 (+https://0509.io; mentions)" },
      });
      const body = await response.text();
      if (response.status === 200) {
        count = (await adapter.parse(body)).length;
      }
    } catch {
      count = 0;
    }
  }
  const next = applyCanary({ ...config, lastCanaryOn: today }, count, now.toISOString());
  await db.prepare("UPDATE source SET config_json = ? WHERE id = ?").bind(JSON.stringify(next), sourceId).run();
  return next;
}

export async function loadSourceConfig(db: D1Database, sourceId: string): Promise<{ pluginKey: string; config: SourceConfig } | null> {
  const row = await db
    .prepare("SELECT plugin_key, config_json FROM source WHERE id = ?")
    .bind(sourceId)
    .first<{ plugin_key: string; config_json: string }>();
  if (!row) return null;
  return { pluginKey: row.plugin_key, config: readSourceConfig(row.config_json) };
}
