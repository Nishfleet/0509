import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { renderDescriptorTemplate } from "../../../app/lib/ads/descriptor";
import {
  adlibQuery,
  candidatesFromAdLibrary,
  metaAdlibDescriptor,
  parseStoredCandidates,
} from "../../../app/lib/discovery/generators/meta-adlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const PAGE = [
  '<script>{"ad_archive_id":"1035896478962196","page_name":"Alphalete Athletics"}</script>',
  '<script>{"pageName":"Lululemon","adArchiveID":"714074828146579"}</script>',
  '<script>{"ad_archive_id":"1847470879199109","page_name":"Gymshark"}</script>',
  '<script>{"ad_archive_id":"999","page_name":"Alphalete Athletics"}</script>',
].join("");

describe("adlibQuery", () => {
  it("searches the card category and market, and falls back to the description", () => {
    expect(
      adlibQuery({ category: "gym apparel", description: "Gym clothing", market: "gb" }),
    ).toEqual({ category: "gym apparel", market: "GB" });
    expect(adlibQuery({ category: "  ", description: "Gym clothing", market: null })).toEqual({
      category: "Gym clothing",
      market: "ALL",
    });
    expect(adlibQuery({ category: null, description: null, market: "GB" })).toBeNull();
    expect(adlibQuery({ category: "shoes", description: null, market: "United Kingdom" })).toEqual({
      category: "shoes",
      market: "ALL",
    });
  });
});

describe("meta ad library page", () => {
  it("builds a browser descriptor whose query is the category and whose country is the market", () => {
    const descriptor = metaAdlibDescriptor("GB");
    const url = renderDescriptorTemplate(descriptor.endpoint, { target: "gym apparel" });
    expect(descriptor.transport).toBe("browser");
    expect(descriptor.waitForSelector).toBe('a[href*="/ads/library/?id="]');
    expect(url).toBe(
      "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=GB&media_type=all&search_type=keyword_unordered&q=gym%20apparel",
    );
  });

  it("emits advertiser, archive record and market, and drops the brand itself", () => {
    const candidates = candidatesFromAdLibrary(
      PAGE,
      { category: "gym apparel", market: "GB" },
      "Gymshark",
    );
    expect(candidates.map((candidate) => candidate.name)).toEqual(["Alphalete Athletics", "Lululemon"]);
    expect(candidates[0]?.evidence).toEqual([
      {
        sourceUrl: "https://www.facebook.com/ads/library/?id=1035896478962196",
        excerpt: "Alphalete Athletics advertises in GB for gym apparel",
        generator: "ads",
      },
      {
        sourceUrl: "https://www.facebook.com/ads/library/?id=999",
        excerpt: "Alphalete Athletics advertises in GB for gym apparel",
        generator: "ads",
      },
    ]);
  });

  it("reads advertiser names from archive links when the page has no embedded names", () => {
    const html =
      '<a href="https://www.facebook.com/ads/library/?id=42">On Running</a><a href="https://www.facebook.com/ads/library/?id=43">Sponsored</a>';
    const candidates = candidatesFromAdLibrary(html, { category: "shoes", market: "ALL" }, "Gymshark");
    expect(candidates.map((candidate) => candidate.name)).toEqual(["On Running"]);
  });

  it("reads candidates back out of a stored payload", () => {
    const body = JSON.stringify({
      candidates: [
        {
          name: "On Running",
          evidence: [{ sourceUrl: "https://www.facebook.com/ads/library/?id=42", excerpt: "x", generator: "ads" }],
        },
      ],
    });
    expect(parseStoredCandidates(body).map((candidate) => candidate.name)).toEqual(["On Running"]);
    expect(parseStoredCandidates("not-json")).toEqual([]);
  });
});

describe("discovery does not run the ad library inside onboarding", () => {
  it("enqueues only after the competitor list is written, and never imports the browser", () => {
    const workflow = readFileSync(join(ROOT, "workers/workflows/discovery.ts"), "utf8");
    const confirm = readFileSync(join(ROOT, "app/lib/identity/confirm.server.ts"), "utf8");
    const browser = readFileSync(join(ROOT, "app/lib/discovery/meta-adlib-browser.server.ts"), "utf8");
    const writeAt = workflow.indexOf('step.do("write"');
    const enqueueAt = workflow.indexOf('step.do("enqueue-adlib"');
    expect(writeAt).toBeGreaterThan(0);
    expect(enqueueAt).toBeGreaterThan(writeAt);
    expect(workflow).toContain("enqueueMetaAdlib");
    expect(workflow).not.toContain("transportBrowser");
    expect(workflow).not.toContain("pullMetaAdlib");
    expect(workflow).not.toContain("runMetaAdlib");
    expect(confirm).not.toContain("transportBrowser");
    expect(confirm).not.toContain("pullMetaAdlib");
    expect(browser).toContain("transportBrowser");
  });
});
