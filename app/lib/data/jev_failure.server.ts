import { env } from "cloudflare:workers";

import type { JevFailure } from "../jev/failure";

const INSERT_FAILURE =
  "INSERT INTO jev_failure (id, question_id, kind, code, message, occurred_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)";

export async function insertJevFailure(questionIds: string, failure: JevFailure, occurredAt: string): Promise<void> {
  await env.DB.prepare(INSERT_FAILURE)
    .bind(crypto.randomUUID(), questionIds, failure.kind, failure.code, failure.message, occurredAt)
    .run();
}
