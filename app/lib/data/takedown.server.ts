import { env } from "cloudflare:workers";

export async function takenDownAmong(subjects: readonly string[]): Promise<ReadonlySet<string>> {
  if (subjects.length === 0) return new Set<string>();
  const placeholders = subjects.map(() => "?").join(", ");
  const { results } = await env.DB.prepare(
    `SELECT subject FROM takedown WHERE subject IN (${placeholders})`,
  )
    .bind(...subjects)
    .all<{ subject: string }>();
  return new Set(results.map((row) => row.subject));
}

export async function isTakenDown(subject: string): Promise<boolean> {
  return (await takenDownAmong([subject])).has(subject);
}
