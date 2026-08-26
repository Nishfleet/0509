import { readFileSync } from "node:fs";
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
  extractMetaContent,
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

describe("extractMetaContent meta-name allowlist", () => {
  const ogHtml = `<html><head><meta property="og:site_name" content="Acme Labs"/></head></html>`;
  const appHtml = `<html><head><meta name="application-name" content="Acme App"/></head></html>`;
  const reversedHtml = `<html><head><meta content="Acme Reversed" property="og:site_name"/></head></html>`;

  it("extracts allowlisted og:site_name and application-name metas", () => {
    expect(extractMetaContent(ogHtml, "og:site_name")).toBe("Acme Labs");
    expect(extractMetaContent(appHtml, "application-name")).toBe("Acme App");
  });

  it("extracts content that appears before the name or property attribute", () => {
    expect(extractMetaContent(reversedHtml, "og:site_name")).toBe("Acme Reversed");
  });

  it("rejects keys that contain regex metacharacters instead of interpolating them", () => {
    expect(extractMetaContent(ogHtml, ".*")).toBeNull();
    expect(extractMetaContent(ogHtml, "(")).toBeNull();
    expect(extractMetaContent(ogHtml, "og:site_name.*")).toBeNull();
  });

  it("rejects unknown meta names even when they are valid HTML names", () => {
    const html = `<html><head>
      <meta name="description" content="not the site name"/>
      <meta property="og:site_name" content="Acme"/>
    </head></html>`;
    expect(extractMetaContent(html, "description")).toBeNull();
    expect(extractMetaContent(html, "og:site_name")).toBe("Acme");
  });

  it("never interpolates a meta key into a RegExp constructor", () => {
    const source = readFileSync("app/lib/website-identity.server.ts", "utf8");
    const start = source.indexOf("function metaContentPatternsForKey");
    const end = source.indexOf("function extractCanonicalUrl");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const region = source.slice(start, end);
    expect(region).not.toMatch(/new\s+RegExp\s*\(/);
    expect(region).toContain("og:site_name");
    expect(region).toContain("application-name");
  });
});
