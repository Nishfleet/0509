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
    // provider question askable.
    mockFetch.mockResolvedValue(
      new Response(null, { status: 403, headers: { "content-type": "text/html" } }),
    );

    const identity = await resolveWebsiteIdentity("https://goat.com");

    expect(identity).not.toBeNull();
    expect(identity?.siteName).toBe("GOAT");
    expect(identity?.aliases).toContain("GOAT");
  });

  it("adds on-running.com as a domain alias to a resolved on.com identity", async () => {
    // The live on.com homepage resolves (with the oversized-page tolerance) to
    // the "On" brand, but its redirect chain never touches on-running.com —
    // the host On's ads still land on. The curated alias connects those ads.
    mockFetch.mockResolvedValue(
      htmlResponse(`<html><head>
        <title>On | Swiss Performance Running Shoes</title>
        <meta property="og:site_name" content="On"/>
      </head><body></body></html>`),
    );

    const identity = await resolveWebsiteIdentity("https://on.com");

    expect(identity).not.toBeNull();
    expect(identity?.siteName).toBe("On");
    expect(identity?.domainAliases).toContain("on-running.com");
    expect(identity?.aliases).toContain("On");
  });

  it("does not fabricate verified coverage for a brand that runs no Meta ads", async () => {
    // The curated facts only affect discovery. A brand with NO override (and no
    // live identity) resolves to null and never gets a synthetic site name.
    mockFetch.mockResolvedValue(new Response(null, { status: 403 }));
    const identity = await resolveWebsiteIdentity("https://unknown-no-ads.example");
    expect(identity).toBeNull();
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
