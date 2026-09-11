import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadIndexableTimelineDomains,
  resolveIndexableTimelineLinkForDomain,
} from "~/lib/ads-internal-links.server";

/**
 * Regression guard for issue #1931: the /ads → /timeline cross-link must be
 * gated by the SAME indexability signal the sitemap uses
 * (`loadIndexableTimelineEntries`), so a demo/empty/410 timeline is never
 * linked. These tests exercise the server-side resolver that the /ads route
 * and /brands hub use, mocking the sitemap's timeline lister to prove the
 * resolver mirrors its decision exactly.
 */

// Each test registers its own vi.doMock for ~/lib/sitemap.server rather than
// sharing a describe-level beforeEach mock. In vitest 4, a test-body
// vi.doMock does not reliably override a beforeEach vi.doMock registered
// earlier in the same tick — the beforeEach factory can win, making tests
// flake. Registering once per test removes the override race entirely
// (fleet-ops FleetMainRed 2026-09-06).
function mockTimelineEntries(
  paths: string[],
  opts: { brandPaths?: string[] } = {},
) {
  vi.resetModules();
  vi.doMock("~/lib/sitemap.server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/lib/sitemap.server")>();
    return {
      ...actual,
      loadIndexableTimelineEntries: vi.fn().mockResolvedValue(
        paths.map((path) => ({ path })),
      ),
      loadIndexableBrandPageEntries: vi
        .fn()
        .mockResolvedValue((opts.brandPaths ?? []).map((path) => ({ path }))),
    };
  });
}

afterEach(() => {
  vi.doUnmock("~/lib/sitemap.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("loadIndexableTimelineDomains", () => {
  it("collects the registrable domain of every indexable /timeline/:domain path", async () => {
    mockTimelineEntries(["/timeline/nike.com", "/timeline/gymshark.com"]);
    const { loadIndexableTimelineDomains } = await import(
      "~/lib/ads-internal-links.server"
    );
    const domains = await loadIndexableTimelineDomains({} as never);
    expect(domains.has("nike.com")).toBe(true);
    expect(domains.has("gymshark.com")).toBe(true);
    expect(domains.has("adidas.com")).toBe(false);
  });

  it("skips non-timeline paths and malformed domains", async () => {
    mockTimelineEntries(["/timeline/nike.com", "/ads/nike.com", "/timeline/"]);
    const { loadIndexableTimelineDomains } = await import(
      "~/lib/ads-internal-links.server"
    );
    const domains = await loadIndexableTimelineDomains({} as never);
    expect(domains.has("nike.com")).toBe(true);
    expect(domains.size).toBe(1);
  });

  it("excludes zero-state collecting domains — only capture-backed timelines are linkable (issue #2881)", async () => {
    mockTimelineEntries(["/timeline/calendly.com"], {
      brandPaths: ["/ads/gymshark.com", "/ads/calendly.com", "/compare/adspyder"],
    });
    const { loadIndexableTimelineDomains } = await import(
      "~/lib/ads-internal-links.server"
    );
    const domains = await loadIndexableTimelineDomains({} as never);
    // Issue #2881: a brand whose timeline has 0 recorded offer states is
    // noindex and never in the sitemap, so public pages must not link to it.
    // Capture-backed domains are linkable; tracked-but-empty ones are not.
    expect(domains.has("calendly.com")).toBe(true);
    expect(domains.has("gymshark.com")).toBe(false);
    expect(domains.size).toBe(1);
  });

  it("degrades to an empty set on a sitemap hiccup (never 500s the page)", async () => {
    vi.resetModules();
    vi.doMock("~/lib/sitemap.server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("~/lib/sitemap.server")>();
      return {
        ...actual,
        loadIndexableTimelineEntries: vi.fn().mockRejectedValue(new Error("D1 down")),
      };
    });
    const { loadIndexableTimelineDomains } = await import(
      "~/lib/ads-internal-links.server"
    );
    const domains = await loadIndexableTimelineDomains({} as never);
    expect(domains.size).toBe(0);
  });
});

describe("resolveIndexableTimelineLinkForDomain", () => {
  it("returns the /timeline/:domain path when the sitemap lists it", async () => {
    mockTimelineEntries(["/timeline/nike.com", "/timeline/gymshark.com"]);
    const { resolveIndexableTimelineLinkForDomain } = await import(
      "~/lib/ads-internal-links.server"
    );
    expect(await resolveIndexableTimelineLinkForDomain({} as never, "nike.com")).toBe(
      "/timeline/nike.com",
    );
  });

  it("returns null for a domain the sitemap does not list (a 410/empty timeline is never linked)", async () => {
    mockTimelineEntries(["/timeline/nike.com"]);
    const { resolveIndexableTimelineLinkForDomain } = await import(
      "~/lib/ads-internal-links.server"
    );
    expect(await resolveIndexableTimelineLinkForDomain({} as never, "adidas.com")).toBeNull();
  });

  it("normalizes www and case before matching", async () => {
    mockTimelineEntries(["/timeline/nike.com"]);
    const { resolveIndexableTimelineLinkForDomain } = await import(
      "~/lib/ads-internal-links.server"
    );
    expect(await resolveIndexableTimelineLinkForDomain({} as never, "www.Nike.com")).toBe(
      "/timeline/nike.com",
    );
  });

  it("returns null for empty or null domains", async () => {
    mockTimelineEntries(["/timeline/nike.com"]);
    const { resolveIndexableTimelineLinkForDomain } = await import(
      "~/lib/ads-internal-links.server"
    );
    expect(await resolveIndexableTimelineLinkForDomain({} as never, null)).toBeNull();
    expect(await resolveIndexableTimelineLinkForDomain({} as never, "")).toBeNull();
    expect(await resolveIndexableTimelineLinkForDomain({} as never, "  ")).toBeNull();
  });
});
