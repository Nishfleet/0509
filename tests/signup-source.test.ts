import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRICING_FREE_SIGNUP_SOURCE } from "~/lib/funnel-measurement.server";
import {
  ALLOWED_SIGNUP_SOURCES,
  allowlistedSignupSource,
  DIGEST_FOOTER_SIGNUP_SOURCE,
  LOCALE_SNEAKER_RESALE_SIGNUP_SOURCES,
  readSignupSourceCookie,
  SIGNUP_SOURCE_COOKIE,
  signupSourceCookieHeader,
  signupSourceFromRequest,
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
