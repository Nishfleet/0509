import { deleteExpiredJevFailures } from "./jev_failure.server";
import { deleteExpiredVisits } from "./workspace_visit.server";

export async function deleteExpiredRows(db: D1Database, now: Date): Promise<void> {
  await Promise.all([deleteExpiredJevFailures(db, now), deleteExpiredVisits(db, now)]);
}
