export async function takedownSubjectsPresent(
  db: D1Database,
  subjects: string[],
): Promise<string[]> {
  if (!subjects.length) return [];
  const rows = await db
    .prepare(`SELECT subject FROM takedown WHERE subject IN (${subjects.map(() => "?").join(",")})`)
    .bind(...subjects)
    .all<{ subject: string }>();
  return (rows.results ?? []).map((r) => r.subject);
}
