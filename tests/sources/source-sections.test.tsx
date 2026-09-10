// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlanEntitlements, PlanFamily } from "~/lib/plan-entitlements";

/**
 * Seam #2218 — SourceSections locked-source renderer.
 *
 * #2212 do:3's locked lines have no renderer otherwise. When the plan's
 * `sources` entitlement is an allowlist, every registry source NOT in that
 * list renders one locked line. Until #2212 adds the field it is absent
 * → "all sources" → no locked lines.
 */

// Mutable per-test entitlement the mocked getPlanEntitlements returns.
let mockSources: string[] | "all" | undefined;

const baseEntitlements = {
  planFamily: "free",
  watchlists: 1,
  collections: 1,
  includedEvidenceChecksPerMonth: 0,
  workspaceSeats: 1,
  digestCadence: "none",
  scheduledScanCadence: "none",
  priorityScanSlots: null,
  monitoringQueuePriority: 2,
  metaSourceStatus: "unavailable",
  sitePageBudget: 0,
  features: new Set(),
  briefs: "first_only" as const,
  sources: "all" as const,
} satisfies PlanEntitlements;

vi.mock("~/lib/plan-entitlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/plan-entitlements")>();
  return {
    ...actual,
    getPlanEntitlements: (_plan: PlanFamily): PlanEntitlements => ({
      ...baseEntitlements,
      ...(mockSources !== undefined ? { sources: mockSources } : {}),
    }),
  };
});

// Imported after the mock so it sees the overridden entitlements.
const { SourceSections } = await import("~/components/sources/source-sections");

describe("SourceSections locked-source renderer", () => {
  beforeEach(() => {
    mockSources = undefined;
  });

  it("renders no locked lines when the plan entitlement has no sources field (all sources)", () => {
    const html = renderToStaticMarkup(
      createElement(SourceSections, { competitorId: "wl-1", plan: "free" as PlanFamily }),
    );
    // Stubs render null; no locked lines without an allowlist.
    expect(html).toBe("");
  });

  it("renders one locked line per plan-disabled source when sources is an allowlist", () => {
    mockSources = ["google"];
    const html = renderToStaticMarkup(
      createElement(SourceSections, { competitorId: "wl-1", plan: "free" as PlanFamily }),
    );
    // Five sources are NOT in the ["google"] allowlist → five locked lines.
    const lockedMatches = html.match(/f9-source-locked-line/g) ?? [];
    expect(lockedMatches).toHaveLength(5);
    expect(html).toContain("is not available on your plan.");
  });

  it("renders no locked lines when sources is 'all'", () => {
    mockSources = "all";
    const html = renderToStaticMarkup(
      createElement(SourceSections, { competitorId: "wl-1", plan: "free" as PlanFamily }),
    );
    expect(html).toBe("");
  });

  it("renders no locked lines when plan is omitted", () => {
    const html = renderToStaticMarkup(
      createElement(SourceSections, { competitorId: "wl-1" }),
    );
    expect(html).toBe("");
  });
});
