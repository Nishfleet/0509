import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  ENTITLEMENT_KEYS,
  MOST_RESTRICTIVE,
  pageRoleInScope,
  paidSourceAllowed,
  resolveEntitlements,
  type Entitlements,
} from "../../app/lib/billing/entitlements";
import { PLANS } from "../../app/lib/billing/plans";

const SCOUT = {
  competitors: 5,
  site_pages_scope: "home_pricing",
  own_site_alerts: false,
  paid_scraper_sources: false,
  marks_history_days: 90,
  standing_history_weeks: 4,
  workspaces_max: 1,
  api_access: true,
} satisfies Entitlements;

const STARTER = {
  competitors: 15,
  site_pages_scope: "all",
  own_site_alerts: true,
  paid_scraper_sources: true,
  marks_history_days: 365,
  standing_history_weeks: 52,
  workspaces_max: 1,
  api_access: true,
} satisfies Entitlements;

const AGENCY = {
  competitors: 50,
  site_pages_scope: "all",
  own_site_alerts: true,
  paid_scraper_sources: true,
  marks_history_days: 365,
  standing_history_weeks: 52,
  workspaces_max: null,
  api_access: true,
} satisfies Entitlements;

const empty = JSON.stringify({});

describe("resolveEntitlements", () => {
  it("returns each tier's full defaults for an empty override object", () => {
    expect(resolveEntitlements("scout", empty)).toEqual(SCOUT);
    expect(resolveEntitlements("starter", empty)).toEqual(STARTER);
    expect(resolveEntitlements("agency", empty)).toEqual(AGENCY);
  });

  it("returns MOST_RESTRICTIVE for an unknown tier", () => {
    expect(resolveEntitlements("enterprise", empty)).toEqual(MOST_RESTRICTIVE);
  });

  it("overrides one key and leaves the other seven at the tier default", () => {
    expect(resolveEntitlements("scout", JSON.stringify({ competitors: 7 }))).toEqual({
      ...SCOUT,
      competitors: 7,
    });
  });

  it("ignores override values of the wrong type", () => {
    expect(resolveEntitlements("scout", JSON.stringify({ competitors: "7", api_access: "yes" }))).toEqual(SCOUT);
  });

  it("is silent for the empty override object a workspace with no plan row gets", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(resolveEntitlements("scout", "{}")).toEqual(SCOUT);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("falls back to the tier defaults and logs when limitsJson is not JSON", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(resolveEntitlements("starter", "not json")).toEqual(STARTER);
      expect(errorSpy).toHaveBeenCalledOnce();
      const logged = JSON.parse(String(errorSpy.mock.calls[0]?.[0])) as {
        event: string;
        error: string;
      };
      expect(logged.event).toBe("billing.limits_json_parse_failed");
      expect(logged.error.length).toBeGreaterThan(0);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("drops override keys that are not in ENTITLEMENT_KEYS", () => {
    const result = resolveEntitlements("scout", JSON.stringify({ unknown_key: true }));
    expect(result).toEqual(SCOUT);
    expect(result).not.toHaveProperty("unknown_key");
    expect(Object.keys(result)).toEqual([...ENTITLEMENT_KEYS]);
  });
});

describe("every entitlement key has a reader (0509#7062)", () => {
  const ROOT = path.resolve(import.meta.dirname, "../..");
  const texts = globSync("{app,workers}/**/*.{ts,tsx}", { cwd: ROOT })
    .filter((file) => !file.startsWith("app/lib/billing/"))
    .map((file) => ({ file, text: readFileSync(path.join(ROOT, file), "utf8") }));

  it.each([...ENTITLEMENT_KEYS])("%s is read outside billing", (key) => {
    const hits = texts.filter(({ text }) => {
      if (!/readEntitlements|resolveEntitlements|readWorkspaceEntitlements/.test(text)) return false;
      return new RegExp(`\\.${key}\\b`).test(text);
    });
    expect(
      hits.map(({ file }) => file),
      `${key} needs a reader outside app/lib/billing`,
    ).not.toEqual([]);
  });

  it("keeps api_access on every live plan", () => {
    expect(PLANS.every((plan) => plan.limits.api_access)).toBe(true);
  });
});

describe("pageRoleInScope (0509#7062)", () => {
  it("keeps home and pricing on Scout and lets Starter take the rest", () => {
    expect(pageRoleInScope("home", "home_pricing")).toBe(true);
    expect(pageRoleInScope("pricing", "home_pricing")).toBe(true);
    expect(pageRoleInScope("other", "home_pricing")).toBe(false);
    expect(pageRoleInScope("other", "all")).toBe(true);
  });
});

describe("paidSourceAllowed (0509#7062)", () => {
  it("denies scraper.paid unless the workspace is entitled", () => {
    expect(paidSourceAllowed("scraper.paid", false)).toBe(false);
    expect(paidSourceAllowed("scraper.paid", true)).toBe(true);
    expect(paidSourceAllowed("site.web", false)).toBe(true);
    expect(paidSourceAllowed("site.web", true)).toBe(true);
  });
});
