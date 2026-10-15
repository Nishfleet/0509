import { describe, expect, it } from "vitest";

import { PRIVACY } from "../app/lib/legal/privacy";
import { SECURITY } from "../app/lib/legal/security";
import { TERMS } from "../app/lib/legal/terms";
import { legalMeta, pageMeta } from "../app/lib/legal/meta";
import { pricingMeta } from "../app/lib/pricing-page";
import { STATUS_META, type PUBLIC_PATHS } from "../app/lib/public-routes";
import { SITE_URL, shareImageMeta } from "../app/lib/structured-data";

type Entry = Record<string, unknown>;

const HOME_TITLE = "Competitor tracking for founders and creators | Five to Nine";
const HOME_DESCRIPTION =
  "Five to Nine watches your competitors' website changes and emails one Monday brief, with screenshots.";

const PAGES: Record<(typeof PUBLIC_PATHS)[number], readonly Entry[]> = {
  "/": [
    { title: HOME_TITLE },
    { name: "description", content: HOME_DESCRIPTION },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}/` },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Five to Nine" },
    { property: "og:title", content: HOME_TITLE },
    { property: "og:description", content: HOME_DESCRIPTION },
    { property: "og:url", content: `${SITE_URL}/` },
    ...shareImageMeta(),
    {
      "script:ld+json": {
        "@graph": [
          { "@type": "Organization" },
          { "@type": "WebSite" },
          { "@type": "SoftwareApplication" },
          { "@type": "FAQPage" },
        ],
      },
    },
  ],
  "/pricing": pricingMeta(),
  "/privacy": legalMeta(PRIVACY),
  "/terms": legalMeta(TERMS),
  "/security": legalMeta(SECURITY),
  "/status": pageMeta(STATUS_META),
};

function field(entries: readonly Entry[], key: string, value: string): Entry[] {
  return entries.filter((entry) => entry[key] === value);
}

function only(entries: readonly Entry[], key: string, value: string): Entry {
  const found = field(entries, key, value);
  expect(found, `${key}=${value} appears ${String(found.length)} times`).toHaveLength(1);
  return found[0] as Entry;
}

function graph(entries: readonly Entry[]): Entry[] {
  const raw = entries.find((entry) => "script:ld+json" in entry)?.["script:ld+json"];
  const parsed = JSON.parse(JSON.stringify(raw)) as { "@graph": Entry[] };
  return parsed["@graph"];
}

describe.each(Object.entries(PAGES))("search and AI-answer meta for %s", (path, entries) => {
  const title = (entries.find((entry) => typeof entry.title === "string")?.title ?? "") as string;
  const description = only(entries, "name", "description").content as string;

  it("has a short title and a description a result snippet can hold", () => {
    expect(title.length).toBeGreaterThan(5);
    expect(title.length).toBeLessThanOrEqual(70);
    expect(description.length).toBeGreaterThanOrEqual(50);
    expect(description.length).toBeLessThanOrEqual(300);
  });

  it("has one canonical on the apex origin that matches og:url", () => {
    expect(only(entries, "rel", "canonical").href).toBe(`${SITE_URL}${path}`);
    expect(only(entries, "property", "og:url").content).toBe(`${SITE_URL}${path}`);
  });

  it("repeats the title and description in Open Graph and carries an absolute share image", () => {
    expect(only(entries, "property", "og:title").content).toBe(title);
    expect(only(entries, "property", "og:description").content).toBe(description);
    expect(only(entries, "property", "og:image").content).toMatch(/^https:\/\/[^/]+\/\S+\.png$/);
    expect(only(entries, "name", "twitter:card").content).toBe("summary_large_image");
  });

  it("ends its breadcrumb on this page and ties its organization to the site", () => {
    const nodes = graph(entries);
    expect(nodes.some((node) => node["@type"] === "Organization")).toBe(true);
    const crumbs = nodes.find((node) => node["@type"] === "BreadcrumbList");
    if (crumbs === undefined) return;
    const items = (crumbs.itemListElement ?? []) as { item: string; position: number }[];
    expect(items.at(-1)?.item).toBe(`${SITE_URL}${path}`);
    expect(items.map((entry) => entry.position)).toEqual(items.map((_, index) => index + 1));
  });
});

describe("across the public pages", () => {
  const all = Object.values(PAGES);

  it("gives every page its own title and description", () => {
    const titles = all.map((entries) => entries.find((entry) => typeof entry.title === "string")?.title);
    const descriptions = all.map((entries) => only(entries, "name", "description").content);
    expect(new Set(titles).size).toBe(all.length);
    expect(new Set(descriptions).size).toBe(all.length);
  });
});
