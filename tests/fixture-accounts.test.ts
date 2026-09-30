import { describe, expect, it } from "vitest";

import { FIXTURE_ACCOUNTS, isFixtureAccount } from "../app/lib/fixture-accounts";

// 0509#6020: the fixed journey accounts are literals here so a typo in
// the module fails this test instead of passing through it.
const FIXED = [
  "e2e+j7@0509.io",
  "e2e+j8-hard@0509.io",
  "e2e+j8-soft@0509.io",
  "e2e+j9-mentions@0509.io",
  "e2e+j12-rollovers@0509.io",
];

describe("fixture accounts", () => {
  it("recognizes each of the five fixed journey accounts", () => {
    for (const email of FIXED) {
      expect(isFixtureAccount(email)).toBe(true);
    }
  });

  it("matches an upper-cased spelling of a fixed account", () => {
    expect(isFixtureAccount("E2E+J7@0509.IO")).toBe(true);
  });

  it("rejects per-run e2e addresses, real users, and the empty string", () => {
    expect(isFixtureAccount("e2e+j3-123@0509.io")).toBe(false);
    expect(isFixtureAccount("someone@gymshark.com")).toBe(false);
    expect(isFixtureAccount("")).toBe(false);
  });

  it("has exactly five entries keyed j7, j8Hard, j8Soft, j9Mentions, j12Rollovers", () => {
    expect(Object.keys(FIXTURE_ACCOUNTS).sort()).toEqual(["j12Rollovers", "j7", "j8Hard", "j8Soft", "j9Mentions"]);
  });

  it("carries a non-negative integer maxCompetitors on every entry", () => {
    for (const account of Object.values(FIXTURE_ACCOUNTS)) {
      expect(Number.isInteger(account.maxCompetitors)).toBe(true);
      expect(account.maxCompetitors).toBeGreaterThanOrEqual(0);
    }
  });
});
