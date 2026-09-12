import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_BRAND_PAGE_DOMAINS, FREE_PREVIEW_SEARCH_DOMAIN } from "~/lib/demo-brand-pages";
import { SWITCH_PAGES } from "~/lib/switch-pages";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

/** Vendor-owned domains render "0 ads found" — they must never be the CTA target. magicbrief.com is dead since the 2026-07-31 shutdown and adspy.com is the vendor's own site, so both fail the same way. */
const BANNED_CTA_DOMAINS = ["visualping.io", "magicbrief.com", "adspy.com"];

const IN_SCOPE_SWITCH_SLUGS = ["panoramata", "visualping", "magicbrief", "adspy"] as const;

// Sitemap-canonical compare pages named by issue 2123.
const IN_SCOPE_COMPARE_SLUGS = [
  "visualping-ad-libraries",
  "foreplay-spyder",
  "panoramata",
] as const;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useRouteLoaderData: vi.fn().mockReturnValue(undefined),
      useLoaderData: vi.fn().mockReturnValue(undefined),
      useActionData: vi.fn().mockReturnValue(undefined),
      useLocation: vi.fn().mockReturnValue({ pathname: "/", search: "", hash: "" }),
      useNavigate: vi.fn().mockReturnValue(vi.fn()),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function renderRoute(routeId: string): Promise<string> {
  const routeModule = (await import(`~/routes/${routeId}`)) as {
    default: () => ReactNode;
  };
  return renderToStaticMarkup(createElement(routeModule.default));
}

describe("free-preview CTA lands on a tracked demo brand (issue 2123)", () => {
  it("points every in-scope switch page's CTA at the demo brand, never the vendor domain", async () => {
    for (const slug of IN_SCOPE_SWITCH_SLUGS) {
      const page = SWITCH_PAGES[slug];
      expect(page.previewSearchDomain, `${slug} must declare previewSearchDomain`).toBe(
        FREE_PREVIEW_SEARCH_DOMAIN,
      );

      const markup = await renderRoute(`switch.${slug}`);
      expect(markup).toContain(`href="/search?q=${FREE_PREVIEW_SEARCH_DOMAIN}"`);
      for (const banned of BANNED_CTA_DOMAINS) {
        expect(markup).not.toContain(`href="/search?q=${banned}"`);
      }
    }
  });

  it("pre-fills the sitemap-canonical compare pages' preview form with the demo brand", async () => {
    for (const slug of IN_SCOPE_COMPARE_SLUGS) {
      const markup = await renderRoute(`compare.${slug}`);
      // React SSR renders defaultValue as the value attribute, so submitting
      // the untouched form lands on /search?website=<demo brand>.
      expect(markup, `${slug} form must ship a pre-filled demo search`).toContain(
        `value="${FREE_PREVIEW_SEARCH_DOMAIN}"`,
      );
    }
  });

  it("gives each compare canonical a non-empty last /search href (the primary CTA)", async () => {
    for (const slug of IN_SCOPE_COMPARE_SLUGS) {
      const markup = await renderRoute(`compare.${slug}`);
      const searchHrefs = markup.match(/href="\/search[^"]*"/g) ?? [];
      expect(searchHrefs.length, `${slug} must keep a /search link`).toBeGreaterThan(0);
      const primary = searchHrefs[searchHrefs.length - 1] ?? "";
      expect(primary, `${slug} primary /search CTA must be a tracked demo search`).toBe(
        `href="/search?website=${FREE_PREVIEW_SEARCH_DOMAIN}"`,
      );
    }
  });

  it("never renders a /search href naming a vendor's own domain on any in-scope page", async () => {
    const routeIds = [
      ...[...IN_SCOPE_SWITCH_SLUGS].map((slug) => `switch.${slug}`),
      ...[...IN_SCOPE_COMPARE_SLUGS].map((slug) => `compare.${slug}`),
    ];
    for (const routeId of routeIds) {
      const markup = await renderRoute(routeId);
      const searchHrefs = markup.match(/href="\/search[^"]*"/g) ?? [];
      for (const href of searchHrefs) {
        for (const banned of BANNED_CTA_DOMAINS) {
          expect(href, `${routeId} renders ${href} naming ${banned}`).not.toContain(banned);
        }
      }
    }
  });

  it("keeps every configured CTA search target inside the tracked demo-brand fixture", () => {
    expect(DEMO_BRAND_PAGE_DOMAINS).toContain(FREE_PREVIEW_SEARCH_DOMAIN);
    for (const page of Object.values(SWITCH_PAGES)) {
      if (!page.previewSearchDomain) continue;
      expect(
        DEMO_BRAND_PAGE_DOMAINS,
        `${page.slug} CTA target must be a tracked demo brand`,
      ).toContain(page.previewSearchDomain);
    }
  });
});
