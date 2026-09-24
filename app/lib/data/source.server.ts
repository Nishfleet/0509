import { env } from "cloudflare:workers";

const ENABLED_SOURCE_ID = `SELECT id FROM source WHERE key = ?1 AND is_enabled = 1`;

export async function readEnabledSourceId(key: string): Promise<string | null> {
  const row = await env.DB.prepare(ENABLED_SOURCE_ID).bind(key).first<{ id: string }>();
  return row?.id ?? null;
}
