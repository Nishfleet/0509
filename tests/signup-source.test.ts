import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRICING_FREE_SIGNUP_SOURCE } from "~/lib/funnel-measurement.server";
import {
  ADS_PAGE_SIGNUP_SOURCE,
  ALLOWED_SIGNUP_SOURCES,
  allowlistedSignupSource,
  COMPARE_PAGE_SIGNUP_SOURCE,
  DIGEST_FOOTER_SIGNUP_SOURCE,
  GUIDE_API_LIMITS_SIGNUP_SOURCE,
  GUIDE_LANDING_PAGE_CHANGES_SIGNUP_SOURCE,
  GUIDE_MONITOR_AD_LIBRARY_SIGNUP_SOURCE,
  GUIDE_OFFER_CHANGE_ALERT_SIGNUP_SOURCE,
  GUIDE_PROVE_WHAT_CHANGED_SIGNUP_SOURCE,
  GUIDE_STANDING_WATCH_SIGNUP_SOURCE,
  GUIDE_TRACK_ADS_SIGNUP_SOURCE,
  GUIDES_HUB_SIGNUP_SOURCE,
  LOCALE_SNEAKER_RESALE_SIGNUP_SOURCES,
  readSignupSourceCookie,
  SIGNUP_SOURCE_COOKIE,
  signupSourceCookieHeader,
  signupSourceFromRequest,
  SWITCH_PAGE_SIGNUP_SOURCE,
  TIMELINE_PAGE_SIGNUP_SOURCE,
} from "~/lib/signup-source";

describe("allowlisted signup_source", () => {
  it("keeps the pricing-free and locale sneaker-resale markers, and nothing else", () => {
    expect(ALLOWED_SIGNUP_SOURCES).toContain(PRICING_FREE_SIGNUP_SOURCE);
    expect(ALLOWED_SIGNUP_SOURCES).toContain(DIGEST_FOOTER_SIGNUP_SOURCE);
    expect(allowlistedSignupSource(PRICING_FREE_SIGNUP_SOURCE)).toBe(PRICING_FREE_SIGNUP_SOURCE);
    expect(allowlistedSignupSource(DIGEST_FOOTER_SIGNUP_SOURCE)).toBe(DIGEST_FOOTER_SIGNUP_SOURCE);
    expect(allowlistedSignupSource("locale-de-sneaker-resale")).toBe("locale-de-sneaker-resale");
    expect([...LOCALE_SNEAKER_RESALE_SIGNUP_SOURCES]).toEqual([
      "locale-en-sneaker-resale",
      "locale-de-sneaker-resale",
      "locale-ja-sneaker-resale",
      "locale-pt-br-sneaker-resale",
    ]);
  });

  it("drops the raw query string, unknown markers, and hostile values", () => {
    expect(allowlistedSignupSource("pricing-free&x=<script>")).toBeNull();
    expect(allowlistedSignupSource("<script>alert(1)</script>")).toBeNull();
    expect(allowlistedSignupSource("/auth/signup?source=pricing-free")).toBeNull();
    expect(allowlistedSignupSource("pricing-free&x=1")).toBeNull();
    expect(allowlistedSignupSource(" PRICING-FREE ")).toBeNull();
    expect(allowlistedSignupSource("")).toBeNull();
    expect(allowlistedSignupSource(null)).toBeNull();
  });

  it("accepts lowercase slugs and ref:<eTLD+1> markers (issue #2108)", () => {
    // Slugs: /^[a-z0-9][a-z0-9-]{0,39}$/ — "not-a-marker" is now a valid slug.
    expect(allowlistedSignupSource("not-a-marker")).toBe("not-a-marker");
    expect(allowlistedSignupSource("summer-2026-launch")).toBe("summer-2026-launch");
    expect(allowlistedSignupSource("a")).toBe("a");
    expect(allowlistedSignupSource(`s${"x".repeat(39)}`)).toBe(`s${"x".repeat(39)}`);
    // Referer markers: /^ref:[a-z0-9.-]{1,40}$/.
    expect(allowlistedSignupSource("ref:example.com")).toBe("ref:example.com");
    expect(allowlistedSignupSource("ref:example.co.uk")).toBe("ref:example.co.uk");
    expect(allowlistedSignupSource(`ref:${"d".repeat(40)}`)).toBe(`ref:${"d".repeat(40)}`);
  });

  it("rejects free text, query strings, full URLs, and out-of-shape values", () => {
    expect(allowlistedSignupSource("My Campaign")).toBeNull();
    expect(allowlistedSignupSource("a?b")).toBeNull();
    expect(allowlistedSignupSource("https://example.com/page")).toBeNull();
    expect(allowlistedSignupSource("ref:example.com?x=1")).toBeNull();
    expect(allowlistedSignupSource("ref:EXAMPLE.com")).toBeNull();
    expect(allowlistedSignupSource("ref:")).toBeNull();
    expect(allowlistedSignupSource("Summer-2026-Launch")).toBeNull();
    expect(allowlistedSignupSource("-leading-hyphen")).toBeNull();
    expect(allowlistedSignupSource("slug_with_underscore")).toBeNull();
    // 41-char slug and 45-char ref marker both exceed the shape bounds.
    expect(allowlistedSignupSource(`s${"x".repeat(40)}`)).toBeNull();
    expect(allowlistedSignupSource(`ref:${"d".repeat(41)}`)).toBeNull();
  });

  it("sets and reads only an allowlisted cookie value", () => {
    const header = signupSourceCookieHeader(
      new Request("https://0509.io/auth/signup"),
      "locale-ja-sneaker-resale",
    );
    expect(header).toContain(`${SIGNUP_SOURCE_COOKIE}=locale-ja-sneaker-resale`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Domain=0509.io");
    expect(header).not.toContain("script");

    const request = new Request("https://0509.io/api/auth/magic-link/verify", {
      headers: { cookie: `${SIGNUP_SOURCE_COOKIE}=locale-ja-sneaker-resale` },
    });
    expect(readSignupSourceCookie(request)).toBe("locale-ja-sneaker-resale");
    expect(
      readSignupSourceCookie(
        new Request("https://0509.io/", {
          headers: { cookie: `${SIGNUP_SOURCE_COOKIE}=<script>` },
        }),
      ),
    ).toBeNull();
  });

  it("round-trips slug and ref: cookie values unchanged (issue #2108)", () => {
    for (const source of ["summer-2026-launch", "ref:example.com"]) {
      const header = signupSourceCookieHeader(new Request("https://0509.io/auth/signup"), source);
      expect(header).toContain(`${SIGNUP_SOURCE_COOKIE}=${encodeURIComponent(source)}`);
      const request = new Request("https://0509.io/api/auth/magic-link/verify", {
        headers: {
          cookie: header.split(";")[0],
        },
      });
      expect(readSignupSourceCookie(request)).toBe(source);
    }
  });
});

describe("signupSourceFromRequest referer fallback (issue #2108)", () => {
  it("derives ref:<eTLD+1> from the Referer header when no source= matches", () => {
    const request = new Request("https://0509.io/auth/signup", {
      headers: { referer: "https://example.com/page" },
    });
    expect(signupSourceFromRequest(request)).toBe("ref:example.com");
  });

  it("keeps only the coarse domain: subdomain, path, and query string are dropped", () => {
    const request = new Request("https://0509.io/auth/signup", {
      headers: { referer: "https://blog.example.co.uk/some/post?utm_source=newsletter" },
    });
    expect(signupSourceFromRequest(request)).toBe("ref:example.co.uk");
  });

  it("prefers an explicit source= over the Referer", () => {
    const request = new Request("https://0509.io/auth/signup?source=pricing-free", {
      headers: { referer: "https://example.com/page" },
    });
    expect(signupSourceFromRequest(request)).toBe("pricing-free");
    expect(signupSourceFromRequest(request, "summer-2026-launch")).toBe("pricing-free");
    const formOnly = new Request("https://0509.io/auth/signup", {
      headers: { referer: "https://example.com/page" },
    });
    expect(signupSourceFromRequest(formOnly, "summer-2026-launch")).toBe("summer-2026-launch");
  });

  it("returns null for a missing, malformed, or non-registrable Referer", () => {
    expect(signupSourceFromRequest(new Request("https://0509.io/auth/signup"))).toBeNull();
    expect(
      signupSourceFromRequest(
        new Request("https://0509.io/auth/signup", {
          headers: { referer: "not a url" },
        }),
      ),
    ).toBeNull();
    expect(
      signupSourceFromRequest(
        new Request("https://0509.io/auth/signup", {
          headers: { referer: "https://localhost:3000/page" },
        }),
      ),
    ).toBeNull();
  });

  it("skips the site's own domain so a self-referer never clobbers external attribution", () => {
    expect(
      signupSourceFromRequest(
        new Request("https://0509.io/auth/signup", {
          headers: { referer: "https://0509.io/auth/signup" },
        }),
      ),
    ).toBeNull();
    expect(
      signupSourceFromRequest(
        new Request("https://0509.in/auth/signup", {
          headers: { referer: "https://app.0509.in/" },
        }),
      ),
    ).toBeNull();
  });
});

describe("migration 0087 ↔ code rule parity (issue #2108 step 2c)", () => {
  // Fixtures where the code rule and the rebuilt CHECK constraint must agree.
  // The DB rule is deliberately the wider net (any 1-44 char [a-z0-9:.-]
  // value); every code-accepted value must satisfy it, and these fixtures
  // pin the cases where accept and reject line up exactly.
  const ACCEPTED_BY_BOTH = [
    "ref:example.com",
    "pricing-free",
    "for_agencies",
    "digest_footer",
    "locale-de-sneaker-resale",
    "summer-2026-launch",
    "search_warming_exhausted",
    "guide_track_ads",
    "a",
  ];
  const REJECTED_BY_BOTH = [
    "My Campaign",
    "a?b",
    "ref:EXAMPLE.com",
    "https://example.com/page",
    "ref:example.com?x=1",
    "<script>",
    "",
    "x".repeat(45),
  ];

  it("the code rule accepts and rejects the fixture list as specified", () => {
    for (const fixture of ACCEPTED_BY_BOTH) {
      expect(allowlistedSignupSource(fixture), `code accepts ${JSON.stringify(fixture)}`).toBe(
        fixture,
      );
    }
    for (const fixture of REJECTED_BY_BOTH) {
      expect(allowlistedSignupSource(fixture), `code rejects ${JSON.stringify(fixture)}`).toBeNull();
    }
  });

  it("the migration SQL carries the same rule: six literals plus the open shape", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "migrations", "0087_signup_source_open_allowlist.sql"),
      "utf8",
    );
    for (const literal of [
      "locale-en-sneaker-resale",
      "locale-de-sneaker-resale",
      "locale-ja-sneaker-resale",
      "locale-pt-br-sneaker-resale",
      "pricing-free",
      "for_agencies",
      "digest_footer",
      "search_warming_exhausted",
      "guide_track_ads",
    ]) {
      expect(sql).toContain(`'${literal}'`);
    }
    expect(sql).toContain("length(signup_source) BETWEEN 1 AND 44");
    expect(sql).toContain("signup_source NOT GLOB '*[^a-z0-9:.-]*'");
    // Every code-accepted fixture is inside the DB rule's bounds, so a value
    // the code emits can never be rejected by the CHECK constraint. The two
    // underscore-bearing live markers are accepted via the literal list (the
    // `toContain` loop above), not the open shape, so they are exempt from the
    // [a-z0-9:.-] char-class check.
    const LITERAL_ONLY = new Set(["search_warming_exhausted", "guide_track_ads", "for_agencies", "digest_footer"]);
    for (const fixture of ACCEPTED_BY_BOTH) {
      expect(fixture.length).toBeGreaterThanOrEqual(1);
      expect(fixture.length).toBeLessThanOrEqual(44);
      if (!LITERAL_ONLY.has(fixture)) {
        expect(fixture).toMatch(/^[a-z0-9:.-]+$/);
      }
    }
  });
});

describe("signup action dual-write", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("sets the allowlisted cookie after a pricing-free signup start and never puts the raw query on the user path", async () => {
    const statements: string[] = [];
    const env = {
      FUNNEL_MEASUREMENT_ENABLED: "1",
      DB: {
        prepare(sql: string) {
          statements.push(sql);
          return {
            bind() {
              return {
                async run() {
                  return { success: true, meta: { changes: 1 } };
                },
              };
            },
          };
        },
      },
    };
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/better-auth.server", () => ({
      isBetterAuthConfigured: vi.fn().mockReturnValue(true),
      isSameOriginAuthFormPost: vi.fn().mockReturnValue(true),
      sendBetterAuthMagicLink: vi.fn().mockResolvedValue(undefined),
    }));

    const { action } = await import("~/routes/auth.signup");
    const request = new Request(
      "http://localhost/auth/signup?source=pricing-free&x=%3Cscript%3E",
      {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: "owner@example.com",
          name: "Owner",
          redirectTo: "/app#setup-checklist",
        }),
      },
    );

    let thrown: unknown;
    try {
      await action({ context: { cloudflare: { env } }, request } as never);
    } catch (error) {
      thrown = error;
    }

    const response = thrown as Response;
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location).toContain("source=pricing-free");
    expect(location).not.toContain("script");
    expect(response.headers.get("Set-Cookie") ?? "").toContain(
      `${SIGNUP_SOURCE_COOKIE}=pricing-free`,
    );
    expect(statements.some((sql) => sql.includes("signup_source_pending"))).toBe(true);
    expect(JSON.stringify(statements)).not.toContain("script");
  });
});

describe("AuthForm hidden signupSource", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("react-router");
  });

  it("posts the allowlisted marker and never the raw query string", async () => {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");
      return {
        ...actual,
        Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
          React.createElement("form", props, children),
        useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      };
    });

    const { AuthForm } = await import("~/components/auth-form");
    const markup = renderToStaticMarkup(
      createElement(AuthForm, {
        mode: "signup",
        redirectTo: "/app#setup-checklist",
        signupSource: "locale-de-sneaker-resale",
      }),
    );

    expect(markup).toContain('name="signupSource"');
    expect(markup).toContain('value="locale-de-sneaker-resale"');
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("utm_");
  });
});

describe("compare/switch/locale route signup CTA attribution (issue #2109)", () => {
  // Every public SEO page's signup CTA must carry an allowlisted `source=`
  // marker so funnel measurement can attribute the signup start to the page
  // that drove it. The shared header "Sign up" pill (class `ld-nav-pill`) is a
  // global nav element, not a page-specific CTA, so it is excluded here; any
  // page-specific signup link that drops its marker fails this test before it
  // can ship an unattributed CTA.
  const ROUTES = [
    // compare routes
    "compare",
    "compare.adspyder",
    "compare.foreplay-spyder",
    "compare.foreplay",
    "compare.meta-ad-library",
    "compare.panoramata",
    "compare.pulzifi",
    "compare.spyland",
    "compare.visualping-ad-libraries",
    "compare.visualping",
    // switch routes
    "switch.panoramata",
    "switch.visualping",
    // locale compare/switch re-exports
    "$locale.compare",
    "$locale.compare.adspyder",
    "$locale.compare.foreplay-spyder",
    "$locale.compare.foreplay",
    "$locale.compare.meta-ad-library",
    "$locale.compare.panoramata",
    "$locale.compare.pulzifi",
    "$locale.compare.spyland",
    "$locale.compare.visualping-ad-libraries",
    "$locale.compare.visualping",
    "$locale.switch.panoramata",
    "$locale.switch.visualping",
    // locale routes that render a page-specific signup CTA
    "$locale.sneaker-resale",
    "$locale.pricing",
    // locale routes that render cleanly (only the shared header pill)
    "$locale.help",
    "$locale.docs",
    "$locale.status",
    "$locale.capture-rules",
    "$locale.changelog",
    "$locale.trust",
    "$locale.api.docs",
  ] as const;

  beforeEach(() => {
    vi.resetModules();
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");
      return {
        ...actual,
        Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
          React.createElement("form", props, children),
        useRouteLoaderData: () => ({ session: null, pricingPlans: [], usageBundles: [] }),
        useLoaderData: () => ({
          locale: "de",
          timelineDomains: [],
          pricingPreview: { available: false },
          surfaces: { asOf: "2026-09-12T00:00:00.000Z", monitoring: null, surfaces: [] },
        }),
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("every compare/switch/locale route's signup links carry an allowlisted marker", async () => {
    for (const route of ROUTES) {
      const { default: Route } = await import(`~/routes/${route}`);
      const markup = renderToStaticMarkup(createElement(Route));

      // The shared header pill is a global nav element, not a page-specific
      // CTA; strip it so the assertion targets the page's own signup links.
      const pageMarkup = markup.replace(/<a[^>]*class="[^"]*ld-nav-pill[^"]*"[^>]*>[\s\S]*?<\/a>/g, "");
      const signupHrefs = pageMarkup.match(/href="([^"]*\/auth\/signup[^"]*)"/g) ?? [];

      // A route may legitimately have no page-specific signup CTA (e.g. a
      // compare page whose only CTA is the free search preview). The rule is:
      // every signup link that IS present must carry an allowlisted marker.
      for (const href of signupHrefs) {
        const url = href.slice("href=\"".length, -1);
        const source = new URL(url, "https://0509.io").searchParams.get("source");
        expect(
          allowlistedSignupSource(source),
          `/${route} signup link ${url} must carry an allowlisted source= marker`,
        ).not.toBeNull();
      }
    }
  }, 60_000);
});

describe("acquisition-family signup attribution (issue #3358)", () => {
  // Issue #3358: the ~162 public acquisition surfaces never tagged
  // signup_source, so the #4518 signups/week meter could not say which
  // surface converted. Every acquisition-surface family's signup CTA — the
  // shared nav Sign up pill, and /ads's own signup links — now carries its
  // family marker. One marker per family; the guides articles keep their
  // pre-existing guide-<name> markers (and #2152's guide_track_ads), the
  // /guides hub gets its own.
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
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")("react-router");
      const React = await import("react");
      return {
        ...actual,
        Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
          React.createElement("form", props, children),
        useRouteLoaderData: () => ({ session: null, pricingPlans: [], usageBundles: [] }),
        useLoaderData: () => ({
          session: null,
          domain: "nike.com",
          adCount: 0,
          brandOwnedAdCount: 0,
          hasCachedAds: false,
          freshForLiveClaim: 0,
          entries: [],
          locale: "en",
          timelineDomains: [],
          pricingPreview: { available: false },
          surfaces: { asOf: "2026-09-12T00:00:00.000Z", monitoring: null, surfaces: [] },
        }),
        useNavigation: () => ({ state: "idle" }),
        useLocation: () => ({ pathname: "/", search: "", hash: "", state: null, key: "default" }),
        useSearchParams: () => [new URLSearchParams(), vi.fn()],
        useMatches: () => [],
        useFetchers: () => [],
      };
    });
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
