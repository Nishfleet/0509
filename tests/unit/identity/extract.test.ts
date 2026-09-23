import { afterEach, describe, expect, it } from "vitest";

import {
  adLibraryHintSchema,
  cascadeName,
  decodeEntities,
  extractSite,
  extractedSiteSchema,
  ldOrganizationSchema,
  navLinkSchema,
  normaliseText,
  organizationFromLdJson,
  profileHost,
  resolveUrl,
  socialHandle,
  socialPlatformFor,
  socialSchema,
  titleWithoutTagline,
  type AdLibraryHint,
  type ExtractedSite,
  type LdOrganization,
  type NavLink,
  type Social,
} from "../../../app/lib/identity/extract";
import {
  duckduckgoIconUrl,
  fetchLogoVerifier,
  logoCandidates,
  logoCandidatesFromSite,
  registrableHost,
  resolveLogo,
  type LogoSource,
} from "../../../app/lib/identity/logo-cascade";
import fixture from "../../fixtures/gymshark-2026-09-21.html?raw";

const PAGE_URL = "https://www.gymshark.com/";

describe("extractSite on the committed Gymshark homepage", () => {
  it("reads og:site_name, the ld+json Organization and the visible text", async () => {
    const site = await extractSite(fixture, PAGE_URL);

    expect(site.ogSiteName).toBe("Gymshark");
    expect(site.ogTitle).toBe("Gymshark Official Store - Gym Clothes & Workout Clothes");
    expect(site.ldOrganization?.name).toBe("Gymshark");
    expect(site.ldOrganization?.url).toBe("https://www.gymshark.com");
    expect(site.ldOrganization?.logo).toBe(
      "https://images.ctfassets.net/wl6q2in9o7k3/QN3GChnXFjOolrl6zNQBp/2b7eb612eea1364ed6afd9b1e3046ba2/Gymshark_Combi_Logo_Black.png?w=1664&q=85&fm=webp",
    );

    expect(site.text.length).toBeGreaterThan(1_000);
    expect(site.text).toContain("Gymshark");
    expect(site.text).not.toMatch(/\s{2,}/);
  });

  it("does not carry the body's inline script source in the hash input", async () => {
    const site = await extractSite(
      '<html><body><p>Visible copy ONLY</p><script>window.__ONLY_IN_SCRIPT__ = 1;</script></body></html>',
      "https://example.com/",
    );
    expect(site.text).toContain("Visible copy ONLY");
    expect(site.text).not.toContain("__ONLY_IN_SCRIPT__");
  });

  it("keeps the fixture's own next-data script out of the hash input", async () => {
    const site = await extractSite(fixture, PAGE_URL);
    expect(site.text).not.toContain("initialI18nStore");
    expect(site.text).not.toContain("_nextI18Next");
  });

  it("recovers the five social handles the design cites", async () => {
    const site = await extractSite(fixture, PAGE_URL);
    const handles = new Map(site.socials.map((social) => [social.platform, social.handle]));

    expect(handles.get("instagram.com")).toBe("gymshark");
    expect(handles.get("tiktok.com")).toBe("gymshark");
    expect(handles.get("youtube.com")).toBe("GymSharkTV");
    expect(handles.get("twitter.com")).toBe("gymshark");
    expect(handles.get("facebook.com")).toBe("GymShark");
  });

  it("collects icon links, the apple-touch icons and the manifest URL", async () => {
    const site = await extractSite(fixture, PAGE_URL);

    expect(site.icons).toContain("https://www.gymshark.com/images/favicon.png");
    expect(site.appleTouchIcons).toContain("https://www.gymshark.com/apple-touch-icon.png");
    expect(site.appleTouchIcons).toContain("https://www.gymshark.com/apple-touch-icon-120x120.png");
    expect(site.manifestUrl).toBe("https://www.gymshark.com/site.webmanifest");
  });

  it("reads a nav anchor's visible label rather than its href", async () => {
    const site = await extractSite(fixture, PAGE_URL);

    expect(site.navLinks).toContainEqual({
      href: "https://www.gymshark.com/pages/commitment-to-accessibility",
      text: "Accessibility Statement",
    });

    const urlLabels = site.navLinks.filter((link) => link.text === link.href);
    const labelled = site.navLinks.filter((link) => link.text !== link.href);
    expect(urlLabels.length).toBeLessThan(labelled.length);
    expect(site.navLinks.length).toBeGreaterThan(0);
    for (const link of site.navLinks) {
      expect(typeof link.text).toBe("string");
      expect(link.href.length).toBeGreaterThan(0);
    }
  });

  it("resolves a nested anchor's label out of its child elements", async () => {
    const site = await extractSite(
      '<html><body><a href="/product"><span>New</span> <b>Arrivals</b></a></body></html>',
      "https://example.com/",
    );
    expect(site.navLinks).toEqual([{ href: "https://example.com/product", text: "New Arrivals" }]);
  });

  it("skips a link inside a hidden subtree so hidden navigation stays out", async () => {
    const site = await extractSite(
      '<html><body><div aria-hidden="true"><a href="/hidden">Hidden Label ONLY</a></div><a href="/visible">Visible Label</a></body></html>',
      "https://example.com/",
    );
    expect(site.navLinks).toEqual([
      { href: "https://example.com/visible", text: "Visible Label" },
    ]);
  });

  it("collects ad-library hints from a link and a data attribute", async () => {
    const site = await extractSite(
      '<html><body><a href="https://www.facebook.com/ads/library/?id=123">Ad Library</a>'
        + '<div data-advertiser-id="98765">x</div></body></html>',
      "https://example.com/",
    );
    expect(site.adLibraryHints).toContainEqual({
      source: "meta",
      value: "https://www.facebook.com/ads/library/?id=123",
    });
    expect(site.adLibraryHints).toContainEqual({ source: "meta", value: "98765" });
  });

  it("records the manifest's empty name as an icon source only, not a name source", async () => {
    const site = await extractSite(fixture, PAGE_URL);
    expect(site.manifestUrl).toBe("https://www.gymshark.com/site.webmanifest");
    expect(cascadeName(site)).toBe("Gymshark");
  });
});

describe("extractSite — the lastInTextNode trap", () => {
  it("joins chunked text once, not per chunk", async () => {
    const html = "<html><body><p>Alpha Beta Gamma Delta</p></body></html>";
    const site = await extractSite(html, "https://example.com/");
    expect(site.text).toBe("Alpha Beta Gamma Delta");
  });

  it("keeps a multi-node paragraph's words in order without phantom splits", async () => {
    const html = [
      "<html><body><div>",
      "<span>One</span> <span>Two</span><span>Three</span>",
      "<p>Four Five</p>",
      "</div></body></html>",
    ].join("");
    const site = await extractSite(html, "https://example.com/");
    expect(site.text).toBe("One Two Three Four Five");
  });

  it("carries an ld+json block that HTMLRewriter delivers in chunks", async () => {
    const org = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Chunked Co",
      logo: "https://cdn.example.com/logo.png",
      sameAs: ["https://www.instagram.com/chunked"],
    };
    const script = `<script type="application/ld+json">${JSON.stringify(org)}</script>`;
    const site = await extractSite(`<html><head>${script}</head><body>x</body></html>`, PAGE_URL);

    expect(site.ldOrganization?.name).toBe("Chunked Co");
    expect(site.ldOrganization?.logo).toBe("https://cdn.example.com/logo.png");
    expect(site.ldOrganization?.sameAs).toEqual(["https://www.instagram.com/chunked"]);
  });
});

describe("cascadeName — the name cascade", () => {
  const base = {
    url: PAGE_URL,
    icons: [],
    appleTouchIcons: [],
    manifestUrl: null,
    socials: [],
    navLinks: [],
    adLibraryHints: [],
    text: "",
  };

  it("prefers the ld+json Organization.name over og:site_name", () => {
    const site: ExtractedSite = { ...base, ldOrganization: { name: "From LD", sameAs: [] }, ogSiteName: "From OG" };
    expect(cascadeName(site, "From Wikidata")).toBe("From LD");
  });

  it("falls to og:site_name when the ld+json has no name", () => {
    const site: ExtractedSite = { ...base, ldOrganization: { sameAs: [] }, ogSiteName: "From OG" };
    expect(cascadeName(site, "From Wikidata")).toBe("From OG");
  });

  it("falls to the title minus its tagline when neither carries a name", () => {
    const site: ExtractedSite = { ...base, title: "Gymshark Official Store - Gym Clothes & Workout Clothes" };
    expect(cascadeName(site, "From Wikidata")).toBe("Gymshark Official Store");
  });

  it("falls to the Wikidata label last", () => {
    const site: ExtractedSite = { ...base };
    expect(cascadeName(site, "Gymshark")).toBe("Gymshark");
    expect(cascadeName(site)).toBeUndefined();
  });

  it("is not blanked by the manifest, whose name is empty on Gymshark", () => {
    const manifestOnly: ExtractedSite = {
      ...base,
      title: undefined,
      ldOrganization: undefined,
      ogSiteName: undefined,
      manifestUrl: "https://www.gymshark.com/site.webmanifest",
    };
    expect(cascadeName(manifestOnly)).toBeUndefined();
  });
});

describe("logoCandidates — the cascade order", () => {
  it("orders ld+json, og:image, apple-touch-icon, then duckduckgo", () => {
    const candidates = logoCandidates({
      ldLogo: "https://cdn.example.com/ld.png",
      ogImage: "https://cdn.example.com/og.png",
      appleTouchIcon: "https://example.com/apple-touch-icon.png",
      pageUrl: "https://www.example.com/",
    });
    expect(candidates.map((candidate) => candidate.source)).toEqual([
      "ld+json",
      "og:image",
      "apple-touch-icon",
      "duckduckgo",
    ]);
    const order: LogoSource[] = candidates.map((candidate) => candidate.source);
    expect(order[0]).toBe("ld+json");
    expect(candidates[3]?.url).toBe("https://icons.duckduckgo.com/ip3/example.com.ico");
  });

  it("uses the duckduckgo rung alone when nothing else is present", () => {
    const candidates = logoCandidates({ pageUrl: "https://www.gymshark.com/" });
    expect(candidates).toEqual([
      { source: "duckduckgo", url: "https://icons.duckduckgo.com/ip3/gymshark.com.ico" },
    ]);
  });

  it("reads the real page's rungs in order", async () => {
    const site = await extractSite(fixture, PAGE_URL);
    const candidates = logoCandidatesFromSite(site);
    expect(candidates.map((candidate) => candidate.source)).toEqual([
      "ld+json",
      "og:image",
      "apple-touch-icon",
      "duckduckgo",
    ]);
    expect(candidates[0]?.url).toContain("images.ctfassets.net");
    expect(candidates[2]?.url).toBe("https://www.gymshark.com/apple-touch-icon.png");
  });

  it("keys the icon proxy on the registrable host", () => {
    expect(registrableHost("https://www.gymshark.com/")).toBe("gymshark.com");
    expect(duckduckgoIconUrl("www.Example.com")).toBe(
      "https://icons.duckduckgo.com/ip3/example.com.ico",
    );
  });
});

describe("resolveLogo — all but one rung failing", () => {
  it("returns the first rung that verifies and stops there", async () => {
    const candidates = logoCandidates({
      ldLogo: "https://cdn.example.com/ld.png",
      ogImage: "https://cdn.example.com/og.png",
      appleTouchIcon: "https://example.com/apple-touch-icon.png",
      pageUrl: "https://example.com/",
    });
    const seen: string[] = [];
    const resolution = await resolveLogo(candidates, async (url) => {
      seen.push(url);
      return url === "https://example.com/apple-touch-icon.png";
    });

    expect(resolution.logo?.source).toBe("apple-touch-icon");
    expect(seen).toEqual([
      "https://cdn.example.com/ld.png",
      "https://cdn.example.com/og.png",
      "https://example.com/apple-touch-icon.png",
    ]);
    expect(resolution.attempted.map((candidate) => candidate.source)).toEqual([
      "ld+json",
      "og:image",
      "apple-touch-icon",
    ]);
  });

  it("returns null and the full attempted list when every rung fails", async () => {
    const candidates = logoCandidates({
      ldLogo: "https://cdn.example.com/ld.png",
      pageUrl: "https://example.com/",
    });
    const resolution = await resolveLogo(candidates, async () => false);
    expect(resolution.logo).toBeNull();
    expect(resolution.attempted).toHaveLength(2);
  });
});

describe("fetchLogoVerifier — GET, res.ok, no head-of-page judgement", () => {
  const realFetch = globalThis.fetch;

  function recordFetch(handler: (request: Request) => Response | Promise<Response>): {
    called: { method: string; url: string }[];
  } {
    const called: { method: string; url: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      called.push({ method: request.method, url: request.url });
      return handler(request);
    }) as typeof fetch;
    return { called };
  }

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("issues a GET and accepts a 200", async () => {
    const { called } = recordFetch(() => new Response(new Uint8Array([0x89, 0x50]), { status: 200, headers: { "content-type": "image/png" } }));
    const ok = await fetchLogoVerifier()("https://cdn.example.com/logo.png");
    expect(ok).toBe(true);
    expect(called).toEqual([{ method: "GET", url: "https://cdn.example.com/logo.png" }]);
  });

  it("accepts a 200 with no content-type header", async () => {
    recordFetch(() => new Response(new Uint8Array([0x00]), { status: 200 }));
    expect(await fetchLogoVerifier()("https://cdn.example.com/logo.png")).toBe(true);
  });

  it("rejects a non-ok response", async () => {
    recordFetch(() => new Response("missing", { status: 404 }));
    expect(await fetchLogoVerifier()("https://cdn.example.com/missing.png")).toBe(false);
  });

  it("accepts a 200 that is itself an HTML page (the verifier does not judge content)", async () => {
    recordFetch(() => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(await fetchLogoVerifier()("https://example.com/docs")).toBe(true);
  });

  it("rejects a thrown fetch without propagating it", async () => {
    globalThis.fetch = (() => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await fetchLogoVerifier()("https://cdn.example.com/logo.png")).toBe(false);
  });
});

describe("extract helpers exposed for the engine's later packets", () => {
  it("normalises whitespace once, over the whole string", () => {
    expect(normaliseText("  a\n\n\tb   c  ")).toBe("a b c");
  });

  it("decodes the entities that survive in getAttribute's raw source text", () => {
    expect(decodeEntities("Gym &amp; Co &lt;b&gt; &quot;x&quot; &#39;y&#39; &nbsp;z")).toBe(
      "Gym & Co <b> \"x\" 'y'  z",
    );
  });

  it("decodes numeric entities both decimal and hex", () => {
    expect(decodeEntities("&#65;&#x42;")).toBe("AB");
    expect(decodeEntities("&#x1f600;")).toBe("\u{1f600}");
  });

  it("resolves an href against the page URL and rejects the unresolvable", () => {
    expect(resolveUrl("/images/favicon.png", "https://www.gymshark.com/en-GB/")).toBe(
      "https://www.gymshark.com/images/favicon.png",
    );
    expect(resolveUrl("not a url", "::::")).toBeNull();
  });

  it("matches a social host by suffix so lookalike hosts do not match", () => {
    expect(profileHost("https://uk.linkedin.com/gymshark")).toBe("uk.linkedin.com");
    expect(profileHost("https://www.instagram.com/gymshark")).toBe("instagram.com");
    expect(socialPlatformFor("uk.linkedin.com")).toBe("linkedin.com");
    expect(socialPlatformFor("notlinkedin.com")).toBeNull();
  });

  it("takes the handle segment, dropping a path prefix or a leading @", () => {
    expect(socialHandle("https://www.youtube.com/user/GymSharkTV")).toBe("GymSharkTV");
    expect(socialHandle("https://www.instagram.com/@gymshark")).toBe("gymshark");
    expect(socialHandle("https://tiktok.com/")).toBeNull();
  });

  it("parses the Organization node out of ld+json, tolerating a broken block", () => {
    const org = organizationFromLdJson(
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Broken &amp; Sons",
        logo: "https://cdn.example.com/logo.png",
        sameAs: ["https://www.instagram.com/gymshark"],
      }),
    );
    expect(org?.name).toBe("Broken & Sons");

    const fromGraph = organizationFromLdJson(
      JSON.stringify({ "@graph": [{ "@type": ["WebSite", "Organization"], name: "Graph Co" }] }),
    );
    expect(fromGraph?.name).toBe("Graph Co");

    expect(organizationFromLdJson("{not json")).toBeUndefined();
    expect(organizationFromLdJson(JSON.stringify({ "@type": "WebSite" }))).toBeUndefined();
  });

  it("strips the tagline from a title, and keeps a separator-free title whole", () => {
    expect(titleWithoutTagline("Gymshark | Official Store")).toBe("Gymshark");
    expect(titleWithoutTagline("Gymshark · Official Store")).toBe("Gymshark");
    expect(titleWithoutTagline("Gymshark — Official Store")).toBe("Gymshark");
    expect(titleWithoutTagline("Gymshark - Official Store")).toBe("Gymshark");
    expect(titleWithoutTagline("Gymshark")).toBe("Gymshark");
    expect(titleWithoutTagline(undefined)).toBeUndefined();
  });

  it("publishes the field schemas the card and the context pack reuse", () => {
    const social: Social = socialSchema.parse({
      platform: "instagram.com",
      url: "https://www.instagram.com/gymshark",
      handle: "gymshark",
    });
    expect(social.handle).toBe("gymshark");

    const nav: NavLink = navLinkSchema.parse({ href: "/products", text: "Products" });
    expect(nav.href).toBe("/products");

    const hint: AdLibraryHint = adLibraryHintSchema.parse({
      source: "meta",
      value: "https://www.facebook.com/ads/library",
    });
    expect(hint.source).toBe("meta");

    const ld: LdOrganization = ldOrganizationSchema.parse({ name: "Gymshark" });
    expect(ld.sameAs).toEqual([]);

    const shape: ExtractedSite = extractedSiteSchema.parse({
      url: "https://www.gymshark.com/",
      text: "hello",
    });
    expect(shape.icons).toEqual([]);
  });

  it("validates the real fixture against the declared schema", async () => {
    const site: ExtractedSite = await extractSite(fixture, PAGE_URL);
    expect(extractedSiteSchema.safeParse(site).success).toBe(true);
  });
});
