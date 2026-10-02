export const FIXTURE_ACCOUNTS = {
  j7: { email: "e2e+j7@0509.io", maxCompetitors: 1 },
  j8Hard: { email: "e2e+j8-hard-v2@0509.io", maxCompetitors: 0 },
  j8Soft: { email: "e2e+j8-soft-v2@0509.io", maxCompetitors: 0 },
  j9Mentions: { email: "e2e+j9-mentions@0509.io", maxCompetitors: 1 },
  j12Rollovers: { email: "e2e+j12-rollovers@0509.io", maxCompetitors: 4 },
  soak: { email: "e2e+soak@0509.io", maxCompetitors: 4 },
} as const;

export function isFixtureAccount(email: string): boolean {
  const normalized = email.toLowerCase();
  return Object.values(FIXTURE_ACCOUNTS).some((account) => account.email === normalized);
}

const PER_RUN_FIXTURE = /^e2e\+[^@]+@0509\.io$/;

export function isPerRunFixtureEmail(email: string): boolean {
  const normalized = email.toLowerCase();
  return PER_RUN_FIXTURE.test(normalized) && !isFixtureAccount(normalized);
}
