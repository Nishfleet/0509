import { takeCount } from "../ai/daily-cap.server";
import { isPerRunFixtureEmail } from "../fixture-accounts";

export const FIXTURE_SIGNUPS_PER_DAY = 100;

export const FIXTURE_MAGIC_LINKS_PER_DAY = 200;

function chargeFixture(email: string, line: string, limit: number): Promise<boolean> {
  if (!isPerRunFixtureEmail(email)) return Promise.resolve(true);
  return takeCount(`${line}:${new Date().toISOString().slice(0, 10)}`, limit);
}

export function chargeFixtureSignup(email: string): Promise<boolean> {
  return chargeFixture(email, "fixture-signups", FIXTURE_SIGNUPS_PER_DAY);
}

export function chargeFixtureMagicLink(email: string): Promise<boolean> {
  return chargeFixture(email, "fixture-magic-links", FIXTURE_MAGIC_LINKS_PER_DAY);
}
