import { countRecentPerRunFixtureUsers } from "../data/user.server";
import { isPerRunFixtureEmail } from "../fixture-accounts";

export const FIXTURE_SIGNUPS_PER_DAY = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function fixtureSignupsOverCap(db: D1Database, email: string, now: Date): Promise<boolean> {
  if (!isPerRunFixtureEmail(email)) return false;
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  return (await countRecentPerRunFixtureUsers(db, since)) >= FIXTURE_SIGNUPS_PER_DAY;
}
