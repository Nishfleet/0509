import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetch, releaseSpy } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  releaseSpy: vi.fn(),
}));

vi.mock("~/lib/fetch-timeout.server", () => ({
  fetchWithTimeout: mockFetch,
  releaseFetchTimeout: releaseSpy,
}));

// Bypass DNS / public-address resolution so resolveWebsiteIdentity reaches the
// HTML parsing path with a deterministic URL.
vi.mock("~/lib/public-url.server", () => ({
  resolvePublicHttpUrl: vi.fn(async (value: string | URL) => new URL(value.toString())),
  resolvePublicRedirectUrl: vi.fn((location: string | null) => location ?? null),
}));

import {
  clearWebsiteIdentityCacheForTests,
  extractTagContent,
  getCuratedAdvertiserPageId,
  getCuratedProviderQuery,
  resolveWebsiteIdentity,
} from "~/lib/website-identity.server";

beforeEach(() => {
  clearWebsiteIdentityCacheForTests();
  mockFetch.mockReset();
  releaseSpy.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

describe("website-identity decode wiring", () => {
  it("decodes og:site_name meta content entities once", async () => {
    mockFetch.mockResolvedValue(
      htmlResponse(
        `<html><head>
          <title>Tom &amp; Jerry &lt;3</title>
          <meta property="og:site_name" content="Acme &quot;q&quot; &#39;s&#39;"/>
        </head><body></body></html>`,
      ),
    );

    const identity = await resolveWebsiteIdentity("https://example.com");

    expect(identity).not.toBeNull();
    // extractMetaContent decodes via the shared single-pass decoder:
    // &quot; -> ", &#39; -> '.
    expect(identity?.siteName).toBe('Acme "q" \'s\'');
    // The decoded site name lands in aliases.
    expect(identity?.aliases).toContain('Acme "q" \'s\'');
  });

  it("does not double-decode an already-decoded ampersand in meta content", async () => {
    mockFetch.mockResolvedValue(
      htmlResponse(
        `<html><head>
          <title>plain</title>
          <meta property="og:site_name" content="a & b already decoded"/>
        </head><body></body></html>`,
      ),
    );

    const identity = await resolveWebsiteIdentity("https://example.com");

    expect(identity?.siteName).toBe("a & b already decoded");
  });

  it("returns null when the fetch fails", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    const identity = await resolveWebsiteIdentity("https://example.com");
    expect(identity).toBeNull();
  });

  it("still resolves identity when the homepage body exceeds the read cap (oversized e-commerce page)", async () => {
    // A modern brand homepage routinely streams more than MAX_IDENTITY_RESPONSE_BYTES
    // of markup (on.com ~620 KB, reebok.com ~1.5 MB decoded). The previous
    // readResponseTextWithinLimit cancelled the stream and returned null the
    // moment the running total crossed the cap, so any oversized homepage failed
    // the WHOLE identity resolution — on.com / reebok.com resolved to null, their
    // provider query degenerated to the bare domain label, and their /ads pages
    // could not publish. The head (<title>, canonical, og:site_name) is inside the
    // cap, so identity must parse the readable prefix instead of bailing.
    const head = `<html><head>
      <title>Reebok(R) Official Site | Life is Not a Spectator Sport</title>
      <meta property="og:site_name" content="Reebok"/>
      <link rel="canonical" href="https://www.reebok.com/"/>
    </head><body>`;
    // Push the body past the 250 KB cap with inert filler after the head.
    const filler = "<div>" + "x".repeat(2_000_000) + "</div>";
    const html = head + filler + "</body></html>";
    mockFetch.mockResolvedValue(htmlResponse(html));

    const identity = await resolveWebsiteIdentity("https://reebok.com");

    expect(identity).not.toBeNull();
    expect(identity?.registrableDomain).toBe("reebok.com");
    expect(identity?.siteName).toBe("Reebok");
    expect(identity?.title).toContain("Reebok");
  });

  it("returns null when a small empty body has no identity-bearing head", async () => {
    mockFetch.mockResolvedValue(htmlResponse(""));
    const identity = await resolveWebsiteIdentity("https://empty.example");
    expect(identity).toBeNull();
  });

  it("returns fallback identity when the live fetch stalls past the deadline (issue #2870)", async () => {
    // The overall identity budget (IDENTITY_RESOLVE_DEADLINE_MS) bounds the
    // blocking segment a slow/bot-walled homepage can add to a cache-hit
    // search: BET 2 measured cache=hit first cards at 26-42 s on a cold
    // isolate because each redirect hop can legally spend 5 s (DoH) + 10 s
    // (fetch). Past the deadline the search must stop waiting and take the
    // curated-only fallback instead of holding the first card hostage.
    vi.useFakeTimers();
    try {
      // Never resolves within the deadline — the stalled-fetch case.
      mockFetch.mockReturnValue(new Promise(() => {}));
      const pending = resolveWebsiteIdentity("https://slow-walled.example");
      const assertion = expect(pending).resolves.toBeNull();
      await vi.advanceTimersByTimeAsync(2_500);
      await assertion;
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves the curated identity when the live fetch stalls past the deadline (issue #2870)", async () => {
    // tcs.com curates siteName + providerQuery. A stalled live homepage fetch
    // must not keep the search waiting past the deadline, and the curated
    // facts must survive the timeout the same way they survive a hard 403 —
    // otherwise a slow CDN turns tcs.com back into a dead-end.
    vi.useFakeTimers();
    try {
      mockFetch.mockReturnValue(new Promise(() => {}));
      const pending = resolveWebsiteIdentity("https://tcs.com");
      const assertion = expect(pending).resolves.toMatchObject({
        registrableDomain: "tcs.com",
        siteName: "Tata Consultancy Services",
      });
      await vi.advanceTimersByTimeAsync(2_500);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("records mamaearth.in as a domain alias when mamaearth.com redirects there", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "https://mamaearth.in/" },
        }),
      )
      .mockResolvedValueOnce(
        htmlResponse(
          `<html><head>
            <title>Mamaearth</title>
            <link rel="canonical" href="https://mamaearth.in/"/>
          </head><body></body></html>`,
        ),
      );

    const identity = await resolveWebsiteIdentity("https://mamaearth.com");

    expect(identity?.registrableDomain).toBe("mamaearth.com");
    expect(identity?.domainAliases).toContain("mamaearth.in");
  });
});

describe("curated identity overrides (sneaker-resale brands, issue #1950)", () => {
  it("supplies GOAT's site name when the bot-blocked homepage cannot be fetched", async () => {
    // goat.com's marketplace CDN returns 403 to scripted fetches regardless of
    // user-agent, so the live fetch fails and identity would resolve to null —
    // leaving the provider query on the bare label "goat", which surfaces
    // keyword junk instead of GOAT's own ads. The curated site name keeps the
    // provider question askable. The curated page id scopes the search to
    // GOAT's Meta page so its own ads surface (issue #1982).
    mockFetch.mockResolvedValue(
      new Response(null, { status: 403, headers: { "content-type": "text/html" } }),
    );

    const identity = await resolveWebsiteIdentity("https://goat.com");

    expect(identity).not.toBeNull();
    expect(identity?.siteName).toBe("GOAT");
    expect(identity?.aliases).toContain("GOAT");
    expect(identity?.advertiserPageId).toBe("746493592053334");
  });

  it("adds on-running.com as a domain alias to a resolved on.com identity", async () => {
    // The live on.com homepage resolves (with the oversized-page tolerance) to
    // the "On" brand, but its redirect chain never touches on-running.com —
    // the host On's ads still land on. The curated alias connects those ads.
    mockFetch.mockResolvedValue(
      htmlResponse(`<html><head>
        <title>On | Swiss Performance Running Shoes</title>
        <meta property="og:site_name" content="On Shop"/>
      </head><body></body></html>`),
    );

    const identity = await resolveWebsiteIdentity("https://on.com");

    expect(identity).not.toBeNull();
    expect(identity?.siteName).toBe("On");
    expect(identity?.domainAliases).toContain("on-running.com");
    expect(identity?.aliases).toContain("On");
    // The live shop label is demoted from query-driver to alias, not deleted.
    expect(identity?.aliases).toContain("On Shop");
    expect(identity?.advertiserPageId).toBe("238939146624");
  });

  it("supplies On's brand site name even when the homepage is bot-blocked (issue #1993)", async () => {
    // on.com's og:site_name is "On Shop" — a shop label Meta Ad Library returns
    // 0 ads for. The curated site name "On" must win whether the live homepage
    // is fetchable (and would otherwise contribute "On Shop") or bot-blocked
    // (and would otherwise contribute nothing, leaving the bare stem "on").
    mockFetch.mockResolvedValue(
      new Response(null, { status: 403, headers: { "content-type": "text/html" } }),
    );

    const identity = await resolveWebsiteIdentity("https://on.com");

    expect(identity).not.toBeNull();
    expect(identity?.siteName).toBe("On");
    expect(identity?.aliases).toContain("On");
    expect(identity?.domainAliases).toContain("on-running.com");
    expect(identity?.advertiserPageId).toBe("238939146624");
  });

  it("supplies Reebok's site name when the homepage is bot-blocked (issue #1993)", async () => {
    // reebok.com's Shopify homepage is bot-blocked for the scripted crawler, so
    // the provider query would degenerate to the bare stem "reebok" — which
    // returns 0 rows from Meta Ad Library. The curated site name keeps the
    // provider question askable (issue #1993).
    mockFetch.mockResolvedValue(
      new Response(null, { status: 403, headers: { "content-type": "text/html" } }),
    );

    const identity = await resolveWebsiteIdentity("https://reebok.com");

    expect(identity).not.toBeNull();
    expect(identity?.siteName).toBe("Reebok");
    expect(identity?.aliases).toContain("Reebok");
  });

  it("does not fabricate verified coverage for a brand that runs no Meta ads", async () => {
    // The curated facts only affect discovery. A brand with NO override (and no
    // live identity) resolves to null and never gets a synthetic site name.
    mockFetch.mockResolvedValue(new Response(null, { status: 403 }));
    const identity = await resolveWebsiteIdentity("https://unknown-no-ads.example");
    expect(identity).toBeNull();
  });

  it("connects ridge.com to its ridgewallet.com/.eu landing hosts (issue #2012)", async () => {
    // ridge.com is the buyer-typed domain, Ridge's ads land on ridgewallet.com
    // and ridgewallet.eu. The live redirect chain never reveals the alias and
    // the stem-extension matcher is same-TLD only, so without the curated
    // override a bare website=ridge.com search dead-ends on "No verified ads
    // for ridge.com" (issue #2012). The aliases must survive a FAILED live
    // fetch (bot-blocked homepage) so the search still resolves.
    mockFetch.mockResolvedValue(
      new Response(null, { status: 403, headers: { "content-type": "text/html" } }),
    );

    const identity = await resolveWebsiteIdentity("https://ridge.com");

    expect(identity).not.toBeNull();
    expect(identity?.siteName).toBe("Ridge");
    expect(identity?.aliases).toContain("Ridge");
    expect(identity?.domainAliases).toContain("ridgewallet.com");
    expect(identity?.domainAliases).toContain("ridgewallet.eu");
  });

  it("connects zappos.com to its www.zappos.com landing host (issue #2059)", async () => {
    // Zappos's verified Meta ads all land on the www host, but the live apex
    // redirect chain never reveals www.zappos.com, so the alias is not
    // discoverable and a bare website=zappos.com search settled on
    // "No verified ads found for zappos.com" while the 13 ads existed in the
    // index (issue #2059). The curated site name pins the provider query to
    // the brand term and the alias supplies the apex↔www link. The facts must
    // survive a FAILED live fetch so the search still resolves.
    mockFetch.mockResolvedValue(
      new Response(null, { status: 403, headers: { "content-type": "text/html" } }),
    );

    const identity = await resolveWebsiteIdentity("https://zappos.com");

    expect(identity).not.toBeNull();
    expect(identity?.siteName).toBe("Zappos");
    expect(identity?.aliases).toContain("Zappos");
    expect(identity?.domainAliases).toContain("www.zappos.com");
  });

  it("asks Meta the curated TCS brand term for tcs.com (issue #2870)", () => {
    // The BET 2 25-domain check dead-ended on tcs.com: website=tcs.com
    // settled on a confirmed 0-row empty state while the curated term is the
    // question Meta actually indexes (live 2026-09-11: q="Tata Consultancy
    // Services" returned 7 real TCS ads; q=TCS and website=tcs.com both
    // returned 0). getCuratedProviderQuery feeds the search-v2 cache key, so
    // the term must resolve synchronously without a network fetch.
    expect(getCuratedProviderQuery("tcs.com")).toBe("Tata Consultancy Services");
    expect(getCuratedProviderQuery("unknown.example")).toBeNull();
  });

  it("exposes curated page ids for the loader/sitemap to re-derive cache keys (issue #1982)", () => {
    // The /ads/:domain loader and sitemap re-derive the same page-scoped cache
    // key the publisher wrote via getCuratedAdvertiserPageId, without a network
    // fetch. Returns null for domains with no curated page id (the common case).
    expect(getCuratedAdvertiserPageId("goat.com")).toBe("746493592053334");
    expect(getCuratedAdvertiserPageId("on.com")).toBe("238939146624");
    expect(getCuratedAdvertiserPageId("nykaa.com")).toBeNull();
    expect(getCuratedAdvertiserPageId("unknown.example")).toBeNull();
  });
});

describe("extractTagContent tag allowlist", () => {
  const titleHtml = "<html><head><title>Acme  Labs</title></head></html>";

  it("extracts allowlisted title tags", () => {
    expect(extractTagContent(titleHtml, "title")).toBe("Acme Labs");
  });

  it("rejects tags that contain regex metacharacters instead of interpolating them", () => {
    expect(extractTagContent(titleHtml, ".*")).toBeNull();
    expect(extractTagContent(titleHtml, "(")).toBeNull();
    expect(extractTagContent(titleHtml, "title.*")).toBeNull();
  });

  it("rejects unknown HTML tags even when they are valid names", () => {
    const html = "<html><head><h1>Not the title</h1><title>Acme</title></head></html>";
    expect(extractTagContent(html, "h1")).toBeNull();
  });
});
