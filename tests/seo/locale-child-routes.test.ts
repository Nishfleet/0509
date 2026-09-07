import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import {
  BUYER_SURFACE_CHILD_PATHS,
  BUYER_SURFACE_LOCALE_IDS,
  htmlLangForPathname,
} from "~/lib/locale-markets";
import { canonicalLinks, SITEMAP_PATHS } from "~/lib/seo";
import routes from "~/routes";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;
type MockFormProps = { children?: ReactNode } & Record<string, unknown>;

/**
 * Locale compare/switch child-route regression canary (issue #1563).
 *
 * Live production probes are the operator canary lane's job (see
 * `scripts/canary-locale-prefix-routes.*` and the issue's `verify:` block);
 * CI cannot hit production reliably. This test enforces the same failure
 * contract statically: every one of the 5×11 locale × child cells must be
 * (a) a real registered route under `:locale` (so the router serves 200, not
 * 404), (b) backed by a `$locale.*.tsx` file that re-exports the EN sibling's
 * component and meta with canonical→EN + the buyer-surface hreflang cluster,
 * (c) mapped by `htmlLangForPathname` to `<html lang="en">` (issue #1570:
 * the content is byte-identical English, so no page may declare a language
 * its content does not speak), and (d) NOT listed in the public sitemap
 * (issue #1570: byte-identical English pages with canonical→EN are excluded
 * to avoid a duplicate-content doorway pattern).
 * A missing cell on any axis is the exact 404 the issue shipped to close.
 */

/** Flatten every route entry's file path from the routes.ts config. */
function collectRouteFiles(nodes: unknown[]): string[] {
  const files: string[] = [];
  for (const node of nodes as Array<Record<string, unknown>>) {
    if (typeof node.file === "string") {
      files.push(node.file);
    }
    if (Array.isArray(node.children)) {
      files.push(...collectRouteFiles(node.children));
    }
  }
  return files;
}

/** EN `file:` value for a locale child, e.g. `/compare/magicbrief` -> `routes/$locale.compare.magicbrief.tsx`. */
function localeFileForChild(child: string): string {
  return `routes/$locale.${child.split("/").filter(Boolean).join(".")}.tsx`;
}

/** On-disk locale child route file, e.g. `/compare/magicbrief` -> `app/routes/$locale.compare.magicbrief.tsx`. */
function localeFileOnDiskForChild(child: string): string {
  return `app/${localeFileForChild(child)}`;
}

/** Dynamic module id for a locale child (imported after the react-router mock is active). */
function localeModuleIdForChild(child: string): string {
  return `~/routes/$locale.${child.split("/").filter(Boolean).join(".")}`;
}

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
      useRouteLoaderData: () => undefined,
      useLoaderData: () => ({ featuredAdsLink: null }),
      useParams: () => ({ locale: "de" }),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("locale compare/switch child routes (issue #1563)", () => {
  it("ships exactly the 11 child routes (8 compare + 3 switch)", () => {
    // The compare set is 8, not 10: /compare/visualping and
    // /compare/foreplay are canonicalized duplicates that left the locale
    // child set with the EN URLs (issue #1481). Their $locale.compare.*
    // route files stay registered so those URLs still render 200.
    expect(BUYER_SURFACE_CHILD_PATHS).toHaveLength(11);
  });

  it("registers every locale child route under :locale in routes.ts", () => {
    const routesText = readFileSync("app/routes.ts", "utf8");
    const registeredFiles = collectRouteFiles(routes as unknown[]);
    for (const child of BUYER_SURFACE_CHILD_PATHS) {
      const file = localeFileForChild(child);
      expect(registeredFiles, `routes.ts missing ${file}`).toContain(file);
      expect(routesText, `routes.ts missing route entry "${child.slice(1)}"`).toContain(
        `"${child.slice(1)}"`,
      );
      expect(routesText, `routes.ts missing ${file}`).toContain(file);
    }
  });

  it("every locale child file re-exports the EN sibling's default + meta with canonical→EN + hreflang links", () => {
    // Structural contract every cell shares. A cell that stops re-exporting
    // the EN component or meta would break the surface this issue shipped to
    // fix — checked textually so a single broken cell fails fast.
    for (const child of BUYER_SURFACE_CHILD_PATHS) {
      const onDisk = localeFileOnDiskForChild(child);
      const text = readFileSync(onDisk, "utf8");
      expect(text, `${onDisk} must import the EN default + re-export its meta`).toMatch(
        /import\s+\w+\s*,\s*\{\s*meta\s*\}\s*from\s+"\.\/(compare|switch)\.[^"]+"\s*;/,
      );
      expect(text, `${onDisk} must re-export the EN meta`).toContain("export { meta };");
      expect(text, `${onDisk} must set canonical→EN`).toContain(
        `canonicalLinks("${child}")`,
      );
      expect(text, `${onDisk} must emit the buyer-surface hreflang cluster`).toContain(
        `buyerSurfaceHreflangLinks("${child.slice(1)}")`,
      );
      expect(text, `${onDisk} must re-export the EN default component`).toMatch(
        /^export default \w+;/m,
      );
    }
  });

  it("each of the 13 locale child routes re-exports the EN meta, default + links that resolve canonical→EN + hreflang", async () => {
    for (const child of BUYER_SURFACE_CHILD_PATHS) {
      const localeModule = (await import(
        localeModuleIdForChild(child)
      )) as any;
      expect(typeof localeModule.default, `no component for ${child}`).toBe("function");
      expect(typeof localeModule.meta, `no meta for ${child}`).toBe("function");
      expect(typeof localeModule.links, `no links for ${child}`).toBe("function");

      const links = localeModule.links() as Array<{ rel?: string; href?: string }>;
      expect(links).toHaveLength(1 + BUYER_SURFACE_LOCALE_IDS.length + 1);
      expect(links[0]).toEqual({ rel: "canonical", href: canonicalLinks(child)[0]?.href });
      const hreflang = links.filter((l) => l.rel === "alternate");
      expect(hreflang).toHaveLength(BUYER_SURFACE_LOCALE_IDS.length + 1);
      expect(hreflang).toContainEqual({
        rel: "alternate",
        hreflang: "x-default",
        href: `https://0509.io${child}`,
      });

      const tags = localeModule.meta() as Array<Record<string, unknown>>;
      const ogUrl = tags.find((tag) => tag.property === "og:url");
      expect(ogUrl?.content, `og:url for ${child}`).toBe(`https://0509.io${child}`);
    }
  });

  it("renders the EN compare body under a locale prefix (not an empty shell)", async () => {
    const { default: Route } = await import("~/routes/$locale.compare.magicbrief");
    const markup = renderToStaticMarkup(createElement(Route));
    expect(markup).toMatch(/<h1/);
    expect(markup).toContain("Moving from MagicBrief?");
  });

  it("renders the EN switch body under a locale prefix", async () => {
    const { default: Route } = await import("~/routes/$locale.switch.visualping");
    const markup = renderToStaticMarkup(createElement(Route));
    expect(markup).toMatch(/<h1/);
  });

  it("maps every locale × child pathname to <html lang>=\"en\" (byte-identical English, issue #1570)", () => {
    // Issue #1570: locale child routes re-export the EN sibling's component
    // verbatim, so the content is English. A page must not declare a language
    // its content does not speak — htmlLangForPathname returns "en" for every
    // locale child path. The genuinely translated sneaker-resale cluster is
    // the only locale surface that keeps its real locale lang.
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      for (const child of BUYER_SURFACE_CHILD_PATHS) {
        expect(
          htmlLangForPathname(`/${locale}${child}`),
          `lang for /${locale}${child}`,
        ).toBe("en");
      }
    }
  });

  it("does NOT list locale child URLs in the public sitemap (byte-identical English, issue #1570)", () => {
    // Issue #1570: locale child routes serve byte-identical English copy with
    // lang="en" and canonical→EN, so listing them as distinct indexable
    // surfaces would be a duplicate-content doorway pattern. They stay
    // reachable (200, canonical→EN) but are excluded from the sitemap.
    expect(BUYER_SURFACE_CHILD_PATHS).toHaveLength(11);
    expect(BUYER_SURFACE_LOCALE_IDS).toHaveLength(5);
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      for (const child of BUYER_SURFACE_CHILD_PATHS) {
        expect(SITEMAP_PATHS as readonly string[]).not.toContain(`/${locale}${child}`);
      }
    }
  });

  it("the locale compare hub links out to locale-prefixed child URLs (not bare EN)", async () => {
    const { default: LocaleCompareHub } = await import("~/routes/$locale.compare");
    const markup = renderToStaticMarkup(createElement(LocaleCompareHub));
    // Scope to the hub's product link list: the shared footer (MarketingFooter)
    // legitimately still links to EN /compare/* pages even on a locale page.
    const start = markup.indexOf('class="ld-compare-hub"');
    expect(start).toBeGreaterThan(-1);
    const end = markup.indexOf("</ul>", start);
    const hubList = markup.slice(start, end);
    for (const comparePath of BUYER_SURFACE_CHILD_PATHS.filter((p) =>
      p.startsWith("/compare/"),
    )) {
      expect(hubList, `hub missing locale-prefixed link ${comparePath}`).toContain(
        `href="/de${comparePath}"`,
      );
      expect(hubList, `hub must not emit bare EN link ${comparePath}`).not.toContain(
        `href="${comparePath}"`,
      );
    }
  });

  it("never passes props across the route-module boundary (withComponentProps drops them)", () => {
    // Structural guard for the issue #1563 failure mode: at build time
    // `@react-router/dev` wraps every route module's default export in
    // `withComponentProps`, which renders the component with only the route
    // props (`params`, `loaderData`, `actionData`, `matches`) and silently
    // discards any caller-supplied props. Unit tests import the unwrapped
    // source module, so a JSX prop like `<CompareRoute localePrefix={...} />`
    // works here but is a no-op in the built app — production `/de/compare`
    // emitted bare EN `/compare/<slug>` links. Guard both halves: the locale
    // child module must not hand any prop to an imported route component,
    // and the EN component must resolve the locale itself via `useParams`.
    const localeChild = readFileSync("app/routes/$locale.compare.tsx", "utf8");
    expect(
      localeChild,
      "$locale.compare.tsx must not pass JSX props to an imported route component — withComponentProps drops them in the built app",
    ).not.toMatch(/<[A-Z][A-Za-z]*\s+[a-zA-Z]+=/);
    const enModule = readFileSync("app/routes/compare.tsx", "utf8");
    expect(
      enModule,
      "compare.tsx must resolve the locale prefix internally via useParams so it survives the build-time withComponentProps wrapper",
    ).toContain("useParams");
  });
});
