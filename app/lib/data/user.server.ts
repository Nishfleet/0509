import { z } from "zod";

import { FIXTURE_ACCOUNTS } from "../fixture-accounts";

const COUNT_RECENT_PER_RUN_FIXTURE_USERS = `SELECT count(*) AS n FROM "user"
WHERE email LIKE 'e2e+%@0509.io' AND createdAt >= ?1
AND lower(email) NOT IN (SELECT value FROM json_each(?2))`;

const countRow = z.object({ n: z.number() });

export async function countRecentPerRunFixtureUsers(db: D1Database, sinceIso: string): Promise<number> {
  const kept = JSON.stringify(Object.values(FIXTURE_ACCOUNTS).map((account) => account.email));
  const row = countRow.parse(await db.prepare(COUNT_RECENT_PER_RUN_FIXTURE_USERS).bind(sinceIso, kept).first());
  return row.n;
}
