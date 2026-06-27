import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSearchV2CacheKey } from "~/lib/search-v2.server";
import { parseSearchInputFromWebsiteField } from "~/lib/search-query";
import { clearWebsiteIdentityCacheForTests } from "~/lib/website-identity.server";

describe("search v2 cache isolation", () => {
  it("uses distinct keys for domain exact vs broader scope", () => {
    const intent = parseSearchInputFromWebsiteField("okara.ai");
    const exact = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent,
      scope: "exact",
      country: "all",
    });
    const broader = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent,
      scope: "broader",
      country: "all",
    });

    expect(exact).toContain("search-v2:domain:okara.ai:exact");
    expect(broader).toContain("search-v2:domain:okara.ai:broader");
    expect(exact).not.toBe(broader);
  });

  it("does not reuse text cache namespace for domain intent", () => {
    const domainIntent = parseSearchInputFromWebsiteField("okara.ai");
    const textIntent = parseSearchInputFromWebsiteField("okara");

    const domainKey = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent: domainIntent,
      scope: "exact",
      country: "all",
    });
    const textKey = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent: textIntent,
      scope: "exact",
      country: "all",
    });

    expect(domainKey.startsWith("search-v2:domain:")).toBe(true);
    expect(textKey.startsWith("search-v2:domain:")).toBe(false);
  });
});

describe("website identity SSRF guard", () => {
  afterEach(() => {
    clearWebsiteIdentityCacheForTests();
    vi.unstubAllGlobals();
  });

  it("refuses localhost identity fetches", async () => {
    const { resolveWebsiteIdentity } = await import("~/lib/website-identity.server");
    const identity = await resolveWebsiteIdentity("http://localhost");
    expect(identity).toBeNull();
  });

  it("refuses metadata IP identity fetches", async () => {
    const { resolveWebsiteIdentity } = await import("~/lib/website-identity.server");
    const identity = await resolveWebsiteIdentity("http://169.254.169.254");
    expect(identity).toBeNull();
  });

  it("returns null when website identity fetches time out", async () => {
    const dnsA = new Response(JSON.stringify({
      Answer: [{ type: 1, data: "93.184.216.34" }],
    }));
    const dnsAaaa = new Response(JSON.stringify({ Answer: [] }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(dnsA.clone())
      .mockResolvedValueOnce(dnsAaaa.clone())
      .mockResolvedValueOnce(dnsA.clone())
      .mockResolvedValueOnce(dnsAaaa.clone())
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    vi.stubGlobal("fetch", fetchMock);

    const { resolveWebsiteIdentity } = await import("~/lib/website-identity.server");
    const identity = await resolveWebsiteIdentity("https://example.com");

    expect(identity).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
