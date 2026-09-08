import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { getSitePageBudget } from "~/lib/plan-entitlements";

/**
 * Committed-configuration guard for Full-Site Watch production enablement
 * (issue #1386). History this exists to prevent: the scan path, coverage
 * label, and plan budgets shipped while FULLSITE_WATCH_ENABLED stayed
 * absent from wrangler.jsonc, so nothing ran in production.
 */
function readWranglerVars(path: string): Record<string, unknown> {
  const raw = readFileSync(path, "utf8");
  const withoutComments = raw
    .split("\n")
    .map((line) => {
      const commentIndex = line.indexOf("//");
      if (commentIndex === -1) return line;
      const before = line.slice(0, commentIndex);
      const quoteCount = (before.match(/"/g) ?? []).length;
      return quoteCount % 2 === 0 ? before : line;
    })
    .join("\n");
  const parsed = JSON.parse(withoutComments) as { vars?: Record<string, unknown> };
  return parsed.vars ?? {};
}

describe("Full-Site Watch production enablement", () => {
  it("turns the flag on in wrangler.jsonc behind a nike.com canary host list", () => {
    const vars = readWranglerVars("wrangler.jsonc");

    expect(vars.FULLSITE_WATCH_ENABLED).toBe("true");
    const hosts = String(vars.FULLSITE_WATCH_CANARY_HOSTS ?? "");
    expect(hosts).toMatch(/nike\.com/);
    expect(hosts.trim().length).toBeGreaterThan(0);
  });

  it("does not claim whole-site coverage in the committed canary posture", () => {
    const vars = readWranglerVars("wrangler.jsonc");
    expect(String(vars.FULLSITE_WATCH_CANARY_HOSTS ?? "").toLowerCase()).not.toContain(
      "whole site",
    );
    expect(getSitePageBudget("free")).toBeLessThan(getSitePageBudget("agency"));
  });
});
