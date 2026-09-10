import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCreativesByDomain } from "~/lib/sources/google-ads/google-ads-transparency.server";

const FIXTURE_DIR = resolve(__dirname, "../fixtures/google-ads-transparency");

function fixture(name: string): string {
  return readFileSync(resolve(FIXTURE_DIR, name), "utf8");
}

/** Build a fetchImpl that returns fresh responses in sequence. Each factory
 * is called on every fetch call so the body is never consumed twice. */
function sequenceFetch(factories: (() => Response)[]): typeof fetch {
  let i = 0;
  const fn = vi.fn(async () => {
    const factory = factories[i++];
    return factory();
  });
  return fn as unknown as typeof fetch;
}

function jsonFactory(body: string, status = 200): () => Response {
  return () =>
    new Response(body, {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

function htmlFactory(body: string, status = 200): () => Response {
  return () =>
    new Response(body, {
      status,
      headers: { "Content-Type": "text/html" },
    });
}

describe("google-ads-transparency fetchCreativesByDomain", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes fields across three domains with different ad mixes", async () => {
    const nike = fixture("nike.com-page1.json");
    const notion = fixture("notion.so.json");
    const zero = fixture("zero-ads.json");

    for (const [domain, body, expectCount] of [
      ["nike.com", nike, 6],
      ["notion.so", notion, 6],
      ["zero-ads.com", zero, 0],
    ] as const) {
      // maxCreatives = expectCount stops paging after the first page for
      // fixtures that carry a next-page token (nike.com).
      const fetchImpl = sequenceFetch([jsonFactory(body)]);
      const result = await fetchCreativesByDomain(domain, { fetchImpl, maxCreatives: expectCount || 1 });
      if (expectCount === 0) {
        expect(result, domain).not.toHaveProperty("unavailable");
        const r = result as { creatives: unknown[]; truncated: boolean };
        expect(r.creatives, domain).toEqual([]);
        expect(r.truncated, domain).toBe(false);
      } else {
        expect(result, domain).not.toHaveProperty("unavailable");
        const r = result as { creatives: ReturnType<typeof Object>[]; truncated: boolean };
        expect(r.creatives, domain).toHaveLength(expectCount);
        for (const c of r.creatives) {
          const creative = c as Record<string, unknown>;
          expect(typeof creative.advertiserId, `${domain} advertiserId`).toBe("string");
          expect(typeof creative.creativeId, `${domain} creativeId`).toBe("string");
          expect(typeof creative.advertiserName, `${domain} advertiserName`).toBe("string");
          expect(["text", "image", "video", "unknown"]).toContain(creative.format);
        }
      }
    }
  });

  it("derives format from the preview structure, not the unreliable `4` key", async () => {
    // Fixtures show the `4` key takes 1/2/3 on image and non-image creatives
    // alike, so it is NOT a text/image/video enum. Format must come from the
    // preview: an `<img …>` html at preview.3.2 -> image, a content.js
    // renderer at preview.1.4 -> text, else -> unknown (see server header).
    const nike = JSON.parse(fixture("nike.com-page1.json"));
    const imgCreatives = nike["1"].filter(
      (c: Record<string, unknown>) => (c["3"] as Record<string, unknown> | undefined)?.["3"],
    );
    const contentJsCreatives = nike["1"].filter(
      (c: Record<string, unknown>) => (c["3"] as Record<string, unknown> | undefined)?.["1"],
    );
    expect(imgCreatives.length).toBeGreaterThan(0);
    expect(contentJsCreatives.length).toBeGreaterThan(0);

    const fetchImpl = sequenceFetch([jsonFactory(fixture("nike.com-page1.json"))]);
    const result = (await fetchCreativesByDomain("nike.com", {
      fetchImpl,
      // Stop after page 1 (the fixture carries a next-page token) so the
      // single-factory sequence never runs dry.
      maxCreatives: nike["1"].length,
    })) as {
      creatives: { creativeId: string; format: string }[];
    };
    for (const c of result.creatives) {
      expect(["text", "image", "video", "unknown"]).toContain(c.format);
      const isImg = imgCreatives.some((ic: Record<string, unknown>) => ic["2"] === c.creativeId);
      const isContentJs = contentJsCreatives.some((ic: Record<string, unknown>) => ic["2"] === c.creativeId);
      if (isImg) {
        expect(c.format, `creative ${c.creativeId} has an img preview`).toBe("image");
      } else if (isContentJs) {
        expect(c.format, `creative ${c.creativeId} has a content.js preview`).toBe("text");
      }
    }
    // Every image preview in the fixture maps to image.
    expect(result.creatives.filter((c) => c.format === "image")).toHaveLength(imgCreatives.length);
  });

  it("extracts previewUrl from the img html and stores only the URL", async () => {
    const notion = JSON.parse(fixture("notion.so.json"));
    const imgCreatives = notion["1"].filter(
      (c: Record<string, unknown>) =>
        c["3"] && typeof c["3"] === "object" && (c["3"] as Record<string, unknown>)["3"],
    );
    const expectedUrls = new Set<string>();
    for (const c of imgCreatives) {
      const html = ((c["3"] as Record<string, unknown>)["3"] as Record<string, unknown>)["2"] as string;
      const m = html.match(/<img[^>]*\bsrc=["']([^"']+)["']/);
      if (m) expectedUrls.add(m[1]);
    }

    const fetchImpl = sequenceFetch([jsonFactory(fixture("notion.so.json"))]);
    const result = (await fetchCreativesByDomain("notion.so", { fetchImpl })) as {
      creatives: { previewUrl: string | null }[];
    };
    const gotUrls = new Set(result.creatives.map((c) => c.previewUrl).filter((u): u is string => u !== null));
    for (const url of expectedUrls) {
      expect(gotUrls.has(url), `previewUrl ${url}`).toBe(true);
    }
  });

  it("pages through results using the next-page token", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const fetchImpl = sequenceFetch([
      jsonFactory(fixture("nike.com-page1.json")),
      jsonFactory(fixture("nike.com-page2.json")),
    ]);

    const pending = fetchCreativesByDomain("nike.com", { fetchImpl, maxCreatives: 9 });
    // advance the 1s inter-page delay
    await vi.advanceTimersByTimeAsync(1000);
    const result = (await pending) as { creatives: { creativeId: string }[]; truncated: boolean };

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.creatives).toHaveLength(9);
  });

  it("stops at maxCreatives and marks truncated when more pages remain", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const page1 = JSON.parse(fixture("nike.com-page1.json"));
    const endlessBody = JSON.stringify({ "1": page1["1"], "2": "more-token" });
    const fetchImpl = sequenceFetch([
      jsonFactory(endlessBody),
      jsonFactory(endlessBody),
      jsonFactory(endlessBody),
      jsonFactory(endlessBody),
      jsonFactory(endlessBody),
      jsonFactory(endlessBody),
    ]);

    const pending = fetchCreativesByDomain("nike.com", { fetchImpl, maxCreatives: 12 });
    // two inter-page delays for three pages (40 -> 80 -> cap at 12 collected early)
    await vi.advanceTimersByTimeAsync(2000);
    const result = (await pending) as { creatives: unknown[]; truncated: boolean };

    expect(result.creatives.length).toBeLessThanOrEqual(12);
    expect(result.truncated).toBe(true);
  });

  it("returns unavailable on non-200", async () => {
    const fetchImpl = sequenceFetch([jsonFactory("{}", 429)]);
    const result = await fetchCreativesByDomain("nike.com", { fetchImpl });
    expect(result).toEqual({ unavailable: true, reason: "http_429" });
  });

  it("returns unavailable on an HTML (captcha) response", async () => {
    const fetchImpl = sequenceFetch([htmlFactory(fixture("unavailable.html"))]);
    const result = await fetchCreativesByDomain("nike.com", { fetchImpl });
    expect(result).toEqual({ unavailable: true, reason: "html_response" });
  });

  it("returns unavailable on a parse failure", async () => {
    const fetchImpl = sequenceFetch([jsonFactory("not json at all")]);
    const result = await fetchCreativesByDomain("nike.com", { fetchImpl });
    expect(result).toEqual({ unavailable: true, reason: "parse_failure" });
  });

  it("returns unavailable on a fetch error (timeout / network)", async () => {
    const fetchImpl = (vi.fn(async () => {
      throw new Error("network");
    }) as unknown) as typeof fetch;
    const result = await fetchCreativesByDomain("nike.com", { fetchImpl });
    expect(result).toEqual({ unavailable: true, reason: "fetch_error" });
  });
});
