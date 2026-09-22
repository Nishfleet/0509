export async function enabledSources(
  db: D1Database,
): Promise<{ id: string; kind: string }[]> {
  const rows = await db
    .prepare(`SELECT id, kind FROM source WHERE is_enabled = 1`)
    .all<{ id: string; kind: string }>();
  return rows.results ?? [];
}
