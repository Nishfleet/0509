import { env } from "cloudflare:workers";

import type { JevFailure } from "../jev/failure";

const INSERT_FAILURE =
  "INSERT INTO jev_failure (id, question, kind, code, message, occurred_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)";

export async function insertJevFailure(questionIds: string, failure: JevFailure, occurredAt: string): Promise<void> {
  await env.DB.prepare(INSERT_FAILURE)
    .bind(crypto.randomUUID(), questionIds, failure.kind, failure.code, failure.message, occurredAt)
    .run();
}

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function deleteExpiredJevFailures(db: D1Database, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_MS).toISOString();
  const result = await db.prepare("DELETE FROM jev_failure WHERE occurred_at < ?1").bind(cutoff).run();
  return result.meta.changes;
}
