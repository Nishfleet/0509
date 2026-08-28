import { readdirSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CAPTURE_VALIDITY_REASON_CODES } from "~/lib/capture-validity.server";
import { NO_PHANTOM_CHANGE_RULES, SWITCH_PAGES, SWITCH_SLUGS } from "~/lib/switch-pages";
import { SITEMAP_PATHS } from "~/lib/seo";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

function parseLdJsonBlocks(markup: string): Array<Record<string, unknown>> {
  const matches = [...markup.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  return matches.map((match) => JSON.parse(match[1] ?? "") as Record<string, unknown>);
}

function visibleText(markup: string) {
  return markup.replace(/&#x27;/g, "'").replace(/&apos;/g, "'").replace(/&rsquo;/g, "'");
}

function switchRouteIds(): string[] {
  return readdirSync("app/routes")
    .filter((name) => /^switch\..+\.tsx$/.test(name))
    .map((name) => name.replace(/\.tsx$/, ""))
    .sort();
}

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

describe("BET 8 switch pages", () => {
  const routeIds = switchRouteIds();

  it("ships exactly the three named switch routes", () => {
    expect(routeIds).toEqual(["switch.magicbrief", "switch.panoramata", "switch.visualping"]);
    expect([...SWITCH_SLUGS].sort()).toEqual(["magicbrief", "panoramata", "visualping"]);
  });

  it("lists every switch path in the public sitemap set", () => {
    for (const page of Object.values(SWITCH_PAGES)) {
      expect(SITEMAP_PATHS as readonly string[]).toContain(page.pathname);
    }
  });

  it("publishes the capture-validity gate as the no-phantom-change rule set", () => {
    expect(NO_PHANTOM_CHANGE_RULES.map((rule) => rule.reasonCode).sort()).toEqual(
      [...CAPTURE_VALIDITY_REASON_CODES].sort(),
    );
  });

  it.each(SWITCH_SLUGS)("%s cites a public source, states the transfer boundary, and ends in /search", async (slug) => {
    const page = SWITCH_PAGES[slug];
    const routeModule = (await import(`~/routes/switch.${slug}`)) as {
      default: () => ReactNode;
      links: () => Array<{ rel?: string; href?: string }>;
      meta: () => Array<{ title?: string; name?: string; content?: string }>;
    };
    const markup = renderToStaticMarkup(createElement(routeModule.default));
    const text = visibleText(markup);

    expect(text).toContain(page.complaint.quote);
    expect(text).toContain(page.complaint.kicker);
    expect(text).toContain(page.complaint.heading);
    expect(markup).toContain(`href="${page.complaint.source.href}"`);
    expect(markup).toContain("What transfers.");
    expect(markup).toContain("What does not transfer.");
    expect(markup).toContain('href="/search?q=');
    expect(markup).toContain(`href="/search?q=${page.ctaBrand}"`);
    expect((markup.match(/href="\/search\?q=/g) ?? []).length).toBe(1);
    expect(markup).toMatch(/no demo form/i);
    expect(markup).not.toContain("source=magicbrief-migration");
    expect(markup).not.toContain("Start migration");
    expect(markup).not.toMatch(/calendly|book a demo/i);

    for (const row of page.transfers) {
      expect(markup).toContain(row.title);
    }
    for (const row of page.doesNotTransfer) {
      expect(markup).toContain(row.title);
    }

    expect(routeModule.links()).toEqual([{ rel: "canonical", href: `https://0509.io${page.pathname}` }]);

    const tags = routeModule.meta();
    const title = tags.find((tag) => "title" in tag)?.title;
    const description = tags.find((tag) => tag.name === "description")?.content;
    expect(title).toBe(page.title);
    expect(description).toBe(page.description);
    expect(description?.length ?? 0).toBeLessThanOrEqual(155);
  });

  it.each(SWITCH_SLUGS)("%s emits one WebPage JSON-LD block aligned with the document head", async (slug) => {
    const page = SWITCH_PAGES[slug];
    const routeModule = (await import(`~/routes/switch.${slug}`)) as { default: () => ReactNode };
    const markup = renderToStaticMarkup(createElement(routeModule.default));
    const blocks = parseLdJsonBlocks(markup);
    const webPages = blocks.filter((block) => block["@type"] === "WebPage");

    expect(webPages).toHaveLength(1);
    const webPage = webPages[0] ?? {};
    expect(webPage["@context"]).toBe("https://schema.org");
    expect(webPage.name).toBe(page.title);
    expect(webPage.description).toBe(page.description);
    expect(webPage.url).toBe(`https://0509.io${page.pathname}`);
    expect(webPage.mainEntity).toEqual({
      "@type": "SoftwareApplication",
      name: page.productName,
    });

    const serialized = JSON.stringify(blocks);
    expect(serialized).not.toMatch(/[$₹€£]\s?\d/);
    expect(serialized).not.toContain('"@type":"AggregateRating"');
    expect(serialized).not.toContain('"@type":"Offer"');
    expect(serialized).not.toContain('"@type":"Review"');
  });

  it("anchors Visualping on the Ad Library URL hunt and publishes the rule set", async () => {
    const { default: Route } = await import("~/routes/switch.visualping");
    const markup = renderToStaticMarkup(createElement(Route));

    expect(markup).toContain("Skip the Ad Library URL hunt and the condition prompt.");
    expect(markup).toContain("https://visualping.io/blog/monitor-competitors-meta-ad-libraries");
    expect(markup).toContain("What we refuse to alert on.");
    for (const rule of NO_PHANTOM_CHANGE_RULES) {
      expect(markup).toContain(rule.title);
    }
  });

  it("does not lead Panoramata with a price table", async () => {
    const { default: Route } = await import("~/routes/switch.panoramata");
    const markup = renderToStaticMarkup(createElement(Route));

    expect(markup).toContain("Same ads and pages job. Paste a domain.");
    expect(markup).toContain("https://www.panoramata.co/track/website-changes");
    expect(markup).toContain("The public record");
    expect(markup).not.toContain("The public complaint");
    expect(markup).not.toMatch(/€99/);
    expect(markup).not.toContain("$250");
  });

  it("anchors MagicBrief on the shutdown and the Canva successor", async () => {
    const { default: Route } = await import("~/routes/switch.magicbrief");
    const markup = renderToStaticMarkup(createElement(Route));

    expect(markup).toContain("MagicBrief closed. Here is what actually moves.");
    expect(markup).toContain("https://magicbrief.com/faqs");
    expect(markup).toContain("Canva Grow");
    expect(markup).toContain("Canva Business");
    expect(markup).not.toContain("$250");
  });

  it("does not promise a screenshot on every new watch (#1182)", async () => {
    // Live D1 on 2026-08-27: 0 of 34 succeeded proof_capture rows in 48h
    // carried a screenshot key. Switch copy must match that coverage, same
    // BET 10 wording as homepage/category/pricing (#977): source-linked
    // proof always, a screenshot only when the capture includes one.
    const copy = JSON.stringify(SWITCH_PAGES);
    const banned = [
      "save fresh screenshots",
      "saves the screenshots",
      "sends screenshot evidence",
      "save screenshot, page text, and the source link when the page actually renders",
      "when the page actually renders",
    ];
    for (const phrase of banned) {
      expect(copy.includes(phrase), `switch copy still contains ${JSON.stringify(phrase)}`).toBe(
        false,
      );
    }

    expect(SWITCH_PAGES.magicbrief.doesNotTransfer.map((row) => row.detail).join("\n")).toMatch(
      /screenshot when the capture includes one/i,
    );
    expect(SWITCH_PAGES.panoramata.transfers.map((row) => row.detail).join("\n")).toMatch(
      /screenshot when the capture includes one/i,
    );

    const { default: MagicBriefRoute } = await import("~/routes/switch.magicbrief");
    const { default: PanoramataRoute } = await import("~/routes/switch.panoramata");
    const magicbrief = visibleText(renderToStaticMarkup(createElement(MagicBriefRoute)));
    const panoramata = visibleText(renderToStaticMarkup(createElement(PanoramataRoute)));
    expect(magicbrief).toContain("screenshot when the capture includes one");
    expect(panoramata).toContain("screenshot when the capture includes one");
    expect(magicbrief).not.toContain("save fresh screenshots");
    expect(panoramata).not.toContain("when the page actually renders");
  });
});
