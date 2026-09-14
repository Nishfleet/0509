import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockReactRouter } from "./helpers/mock-react-router";

import {
  ADS_PAGE_SIGNUP_SOURCE,
  ALLOWED_SIGNUP_SOURCES,
  allowlistedSignupSource,
  COMPARE_PAGE_SIGNUP_SOURCE,
  GUIDE_API_LIMITS_SIGNUP_SOURCE,
  GUIDE_LANDING_PAGE_CHANGES_SIGNUP_SOURCE,
  GUIDE_MONITOR_AD_LIBRARY_SIGNUP_SOURCE,
  GUIDE_OFFER_CHANGE_ALERT_SIGNUP_SOURCE,
  GUIDE_PROVE_WHAT_CHANGED_SIGNUP_SOURCE,
  GUIDE_STANDING_WATCH_SIGNUP_SOURCE,
  GUIDE_TRACK_ADS_SIGNUP_SOURCE,
  GUIDES_HUB_SIGNUP_SOURCE,
  SWITCH_PAGE_SIGNUP_SOURCE,
  TIMELINE_PAGE_SIGNUP_SOURCE,
} from "~/lib/signup-source";

describe("acquisition-family signup attribution (issue #3358)", () => {
  // Issue #3358: the ~162 public acquisition surfaces never tagged
  // signup_source, so the #4518 signups/week meter could not say which
  // surface converted. Every acquisition-surface family's signup CTA — the
  // shared nav Sign up pill, and /ads's own signup links — now carries its
  // family marker. One marker per family; the guides articles keep their
  // pre-existing guide-<name> markers (and #2152's guide_track_ads), the
  // /guides hub gets its own.
  //
  // This block lives in its own file, not tests/signup-source.test.ts: that
  // file's issue-#2109 block renders ~30 route modules in one test and leaves
  // the fork's heap near the 2GB vitest ceiling, so the next dynamic import
  // in the same fork mark-compacts to death (measured 2026-09-14: the worker
  // fork died entering this describe). A fresh file gets a fresh fork.
  const FAMILY_MARKERS = [
    ADS_PAGE_SIGNUP_SOURCE,
    COMPARE_PAGE_SIGNUP_SOURCE,
    SWITCH_PAGE_SIGNUP_SOURCE,
    TIMELINE_PAGE_SIGNUP_SOURCE,
    GUIDES_HUB_SIGNUP_SOURCE,
  ];

  it("registers the five family markers in the existing allowlist, hyphenated", () => {
    for (const marker of FAMILY_MARKERS) {
      expect(ALLOWED_SIGNUP_SOURCES).toContain(marker);
      expect(allowlistedSignupSource(marker)).toBe(marker);
    }
    // The issue's "e.g. ads_page" spellings: underscore slugs do not pass the
    // open shape (/^[a-z0-9][a-z0-9-]{0,39}$/ — 0087's CHECK class is
    // [a-z0-9:.-] for the same reason), so the shipped markers are hyphenated
    // and no migration literal is needed. Underscores only pass as the exact
    // constants 0087 grandfathered (for_agencies, guide_track_ads, ...).
    expect(allowlistedSignupSource("ads_page")).toBeNull();
    expect(allowlistedSignupSource("compare_page")).toBeNull();
    expect(allowlistedSignupSource("switch_page")).toBeNull();
    expect(allowlistedSignupSource("timeline_page")).toBeNull();
    // The guide-article pills ride the seven constants #2108-era work already
    // shipped; #3358 adds no guide marker.
    for (const marker of [
      GUIDE_TRACK_ADS_SIGNUP_SOURCE,
      GUIDE_MONITOR_AD_LIBRARY_SIGNUP_SOURCE,
      GUIDE_LANDING_PAGE_CHANGES_SIGNUP_SOURCE,
      GUIDE_OFFER_CHANGE_ALERT_SIGNUP_SOURCE,
      GUIDE_PROVE_WHAT_CHANGED_SIGNUP_SOURCE,
      GUIDE_STANDING_WATCH_SIGNUP_SOURCE,
      GUIDE_API_LIMITS_SIGNUP_SOURCE,
    ]) {
      expect(ALLOWED_SIGNUP_SOURCES).toContain(marker);
      expect(allowlistedSignupSource(marker)).toBe(marker);
    }
  });

  // The pill IS the only signup CTA on the compare, switch, /guides and
  // /timeline surfaces, so it must carry exactly the family marker. Rendering
  // all ~40 acquisition routes in one fork OOMs the 2GB vitest fork heap
  // (measured: one route module + deps is ~40MB), so full coverage here is
  // STATIC — every acquisition file must wire its family marker into its
  // signup CTA, the same shape as the issue's own grep termination check —
  // and a one-per-family render spot-check pins the runtime href.
  const FAMILY_WIRING: Array<[string, string[]]> = [
    // The shared pill construction itself must keep the source param.
    [
      "app/components/marketing-nav.tsx",
      ['to={signupSource ? `/auth/signup?source=${signupSource}` : "/auth/signup"}'],
    ],
    // Every switch route renders SwitchLanding, which passes the marker.
    ["app/components/switch-landing.tsx", ["signupSource={SWITCH_PAGE_SIGNUP_SOURCE}"]],
    [
      "app/routes/ads.$domain.tsx",
      [
        "signupSource={ADS_PAGE_SIGNUP_SOURCE}",
        // Both /ads CTA URLs (plain + Track CTA) carry the marker.
        "/auth/signup?source=ads-page&redirectTo=",
        "&source=ads-page&redirectTo=",
      ],
    ],
    [
      "app/routes/timeline.$domain.tsx",
      [
        "signupSource={TIMELINE_PAGE_SIGNUP_SOURCE}",
        "/auth/signup?source=timeline-page&redirectTo=",
      ],
    ],
    ["app/routes/timeline.tsx", ["signupSource={TIMELINE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/guides.tsx", ["signupSource={GUIDES_HUB_SIGNUP_SOURCE}"]],
    ["app/routes/compare.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/compare.adspy.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/compare.adspyder.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/compare.bigspy.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/compare.foreplay.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/compare.foreplay-spyder.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/compare.gethookd.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/compare.keeptabz.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/compare.meta-ad-library.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/compare.minea.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/compare.panoramata.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/compare.poweradspy.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/compare.pulzifi.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/compare.sneakerping.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/compare.spyland.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/compare.visualping.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    ["app/routes/compare.visualping-ad-libraries.tsx", ["signupSource={COMPARE_PAGE_SIGNUP_SOURCE}"]],
    // The singular /compare/visualping-ad-library 301-redirects to the plural
    // winner (#2085), so it never renders its own pill.
    [
      "app/routes/guides.how-to-track-competitor-ads.tsx",
      ["signupSource={GUIDE_TRACK_ADS_SIGNUP_SOURCE}"],
    ],
    [
      "app/routes/guides.how-to-get-alerted-when-a-competitor-changes-their-offer.tsx",
      ["signupSource={GUIDE_OFFER_CHANGE_ALERT_SIGNUP_SOURCE}"],
    ],
    [
      "app/routes/guides.how-to-monitor-competitor-landing-page-changes.tsx",
      ["signupSource={GUIDE_LANDING_PAGE_CHANGES_SIGNUP_SOURCE}"],
    ],
    [
      "app/routes/guides.how-to-monitor-meta-ad-library.tsx",
      ["signupSource={GUIDE_MONITOR_AD_LIBRARY_SIGNUP_SOURCE}"],
    ],
    [
      "app/routes/guides.how-to-prove-what-changed-on-a-competitor-website.tsx",
      ["signupSource={GUIDE_PROVE_WHAT_CHANGED_SIGNUP_SOURCE}"],
    ],
    [
      "app/routes/guides.how-to-turn-a-one-off-competitor-check-into-a-standing-watch.tsx",
      ["signupSource={GUIDE_STANDING_WATCH_SIGNUP_SOURCE}"],
    ],
    [
      "app/routes/guides.meta-ad-library-api-limitations.tsx",
      ["signupSource={GUIDE_API_LIMITS_SIGNUP_SOURCE}"],
    ],
    // The $locale buyer-surface children re-export the EN route components
    // (#1562): the pill they render is the EN pill by construction.
    ["app/routes/$locale.compare.tsx", ['import CompareRoute, { meta } from "./compare"']],
  ];

  beforeEach(() => {
    vi.resetModules();
    mockReactRouter({ loaderData: { session: null, pricingPlans: [], usageBundles: [] } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("every acquisition surface file wires its family marker into its signup CTA", () => {
    for (const [file, expectedSubstrings] of FAMILY_WIRING) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      for (const expected of expectedSubstrings) {
        expect(source, `${file} must contain ${JSON.stringify(expected)}`).toContain(expected);
      }
    }
  });

  // The pill href construction lives in ONE place — marketing-nav's Sign up
  // pill — so the runtime proof is a component render per family marker.
  // Rendering whole route modules here OOMed the 2GB vitest fork heap
  // (measured 2026-09-13/14: 7 sequential route imports + renders in one fork
  // died at the heap limit; one route module + deps is ~40MB), so the
  // per-file wiring above stays static and only the pill mechanism renders.
  it("the Sign up pill carries exactly its family marker, per family (component render)", async () => {
    const { MarketingNav } = await import("~/components/marketing-nav");
    for (const expected of [...FAMILY_MARKERS, GUIDE_TRACK_ADS_SIGNUP_SOURCE]) {
      const markup = renderToStaticMarkup(
        createElement(MarketingNav, { signupSource: expected }),
      );
      const href =
        markup.match(/<a[^>]*class="[^"]*ld-nav-pill[^"]*"[^>]*>[\s\S]*?<\/a>/)?.[0]?.match(
          /href="([^"]*)"/,
        )?.[1] ?? "";
      expect(href.startsWith("/auth/signup"), `pill stays on /auth/signup for ${expected}`).toBe(
        true,
      );
      expect(
        new URL(href, "https://0509.io").searchParams.get("source"),
        `the Sign up pill must carry source=${expected}`,
      ).toBe(expected);
    }
    // Surfaces with no family marker keep the bare pill — the default must
    // not leak a marker onto non-acquisition surfaces.
    const bare = renderToStaticMarkup(createElement(MarketingNav));
    expect(bare).toContain('href="/auth/signup"');
    expect(bare).not.toContain("source=");
  });
});
