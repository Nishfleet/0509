import { env } from "cloudflare:workers";
import { z } from "zod";

import { deleteApiKeysForUser } from "./apikey.server";

const OWNED_BY_USER = `(w.owner_user_id = u.id OR parent.owner_user_id = u.id)`;

const SELECT_FIXTURE_REAP_CANDIDATES = `SELECT u.id AS id, u.email AS email FROM "user" u
WHERE u.email LIKE 'e2e+%@0509.io'
  AND lower(u.email) NOT IN (SELECT value FROM json_each(?2))
  AND u.createdAt < ?1
  AND NOT EXISTS (
    SELECT 1 FROM workspace w LEFT JOIN workspace parent ON parent.id = w.parent_workspace_id
    WHERE ${OWNED_BY_USER} AND w.fixture = 0
  )
  AND NOT EXISTS (
    SELECT 1 FROM workspace w LEFT JOIN workspace parent ON parent.id = w.parent_workspace_id
    JOIN plan p ON p.workspace_id = w.id
    WHERE ${OWNED_BY_USER}
  )
ORDER BY u.createdAt, u.id
LIMIT ?3`;

const DELETE_USER = `DELETE FROM "user" WHERE id = ? RETURNING id`;

const fixtureCandidateRow = z.object({ id: z.string(), email: z.string() });

export type FixtureCandidate = z.infer<typeof fixtureCandidateRow>;

export async function readFixtureReapCandidates(
  createdBefore: string,
  keptEmails: readonly string[],
  limit: number,
): Promise<FixtureCandidate[]> {
  const { results } = await env.DB.prepare(SELECT_FIXTURE_REAP_CANDIDATES)
    .bind(createdBefore, JSON.stringify(keptEmails), limit)
    .all();
  return fixtureCandidateRow.array().parse(results);
}

export async function deleteUserWithApiKeys(userId: string): Promise<number> {
  const [, user] = await env.DB.batch([deleteApiKeysForUser(env.DB, userId), env.DB.prepare(DELETE_USER).bind(userId)]);
  return user?.results.length ?? 0;
}
