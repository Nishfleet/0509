import { describe, expect, it } from "vitest";

import { extractIdentity, identityExtractSchema } from "../../../app/lib/identity/extract";
import { extractPageText } from "../../../app/lib/site/extract-text";
import gym from "../../fixtures/gymshark-2026-09-22-a.html?raw";

const pageUrl = "https://www.gymshark.com/";

describe("extractIdentity", () => {
  it("reads the Gymshark homepage into the identity card fields", async () => {
    const card = await extractIdentity(gym, pageUrl);

    expect(identityExtractSchema.safeParse(card).success).toBe(true);
    expect(card.nameSources.ogSiteName).toBe("Gymshark");
    expect(card.nameSources.ldOrganizationName).toBe("Gymshark");
    expect(card.nameSources.title).toBe("Gymshark Official Store");
    expect(card.description).toBe(
      "Unlock your full potential with our game-changing workout clothes. Shop gym clothing for the gym, running &amp; everything in-between. Free delivery on orders over $75",
    );
    expect(card.ogImage).toBe(
      "http://cdn.shopify.com/s/files/1/0098/8822/files/gymshark_social_banner_1200x1200.jpg?v=1549554764",
    );
    expect(card.ldOrganizationLogo).toContain("images.ctfassets.net/wl6q2in9o7k3/QN3GChnXFjOolrl6zNQBp/");
    expect(card.ldOrganizationLogo).toContain("Gymshark_Combi_Logo_Black.png");
    expect(card.socials.map((s) => s.platform).sort()).toEqual([
      "facebook",
      "instagram",
      "tiktok",
      "twitter",
      "youtube",
    ]);
    expect(card.socials).toEqual([
      { platform: "facebook", url: "https://www.facebook.com/Gymshark/" },
      { platform: "twitter", url: "https://twitter.com/Gymshark" },
      { platform: "instagram", url: "https://www.instagram.com/gymshark/" },
      { platform: "youtube", url: "http://www.youtube.com/@gymshark" },
      { platform: "tiktok", url: "https://www.tiktok.com/@gymshark" },
    ]);
    expect(card.navLinks).toContain("https://www.gymshark.com/blog");
    expect(card.navLinks.every((link) => link.startsWith("https://www.gymshark.com/"))).toBe(true);
    expect(card.adLibraryHints).toEqual([]);
    expect(card.manifestUrl).toBe("https://www.gymshark.com/site.webmanifest");
    expect(card.appleTouchIcon).toBe("https://www.gymshark.com/apple-touch-icon.png");
    expect(card.text).toBe((await extractPageText(gym)).text);
  });

  it("keeps a title that arrives in more than one chunk", async () => {
    const card = await extractIdentity(`<title>${"a".repeat(70_000)}</title>`, pageUrl);

    expect(card.nameSources.title).toHaveLength(70_000);
  });

  it("skips an ld+json block that is not JSON", async () => {
    const card = await extractIdentity('<script type="application/ld+json">{not json</script>', pageUrl);

    expect(card.nameSources.ldOrganizationName).toBeNull();
  });

  it("falls back to the meta description when og:description is absent", async () => {
    const card = await extractIdentity('<meta name="description" content="meta description only">', pageUrl);

    expect(card.description).toBe("meta description only");
  });

  it("keeps same-origin nav links and collects ad-library hints", async () => {
    const card = await extractIdentity(
      [
        '<meta property="og:description" content="og description wins">',
        "<nav>",
        '<a href="/men">Men</a>',
        '<a href="/men">Men again</a>',
        '<a href="https://uk.gymshark.com/pages/stores">Stores</a>',
        '<a href="https://www.facebook.com/ads/library/?active_status=all">Ad library</a>',
        '<a href="https://adstransparency.google.com/?region=US">Meta ad library</a>',
        "</nav>",
      ].join(""),
      pageUrl,
    );

    expect(card.description).toBe("og description wins");
    expect(card.navLinks).toEqual(["https://www.gymshark.com/men"]);
    expect(card.adLibraryHints).toEqual([
      "https://www.facebook.com/ads/library/?active_status=all",
      "https://adstransparency.google.com/?region=US",
    ]);
    expect(card.socials).toEqual([]);
  });

  it("returns same-origin nav pages with their anchor titles", async () => {
    const card = await extractIdentity(
      '<html><body><nav><a href="/collections/all-products">  All\n Products </a><a href="/collections/all-products">Dup</a><a href="https://other.example/x">Off</a></nav></body></html>',
      pageUrl,
    );

    expect(card.navPages).toEqual([
      { url: "https://www.gymshark.com/collections/all-products", title: "All Products" },
    ]);
  });

  it("does not append off-origin anchor text to the previous nav title", async () => {
    const card = await extractIdentity(
      '<nav><a href="/shop">Shop</a><a href="https://www.instagram.com/gymshark/">Instagram</a></nav>',
      pageUrl,
    );

    expect(card.navPages).toEqual([{ url: "https://www.gymshark.com/shop", title: "Shop" }]);
  });

  it("also collects same-origin pages linked from the header, the footer and a navigation role, nav first", async () => {
    const card = await extractIdentity(
      [
        '<header><a href="/shop">Shop</a></header>',
        '<nav><a href="/men">Men</a></nav>',
        '<div role="navigation"><a href="/plans">Our <span>plans</span></a></div>',
        '<footer><a href="/pricing">Pricing</a><a href="/men">Men again</a><a href="https://other.example/x">Off</a></footer>',
      ].join(""),
      pageUrl,
    );

    expect(card.navPages).toEqual([
      { url: "https://www.gymshark.com/men", title: "Men" },
      { url: "https://www.gymshark.com/shop", title: "Shop" },
      { url: "https://www.gymshark.com/plans", title: "Our plans" },
      { url: "https://www.gymshark.com/pricing", title: "Pricing" },
    ]);
    expect(card.navLinks).toEqual(["https://www.gymshark.com/men"]);
  });

  it("skips in-page fragment links in the nav", async () => {
    const card = await extractIdentity('<nav><a href="#top">Top</a><a href="/men">Men</a></nav>', pageUrl);

    expect(card.navLinks).toEqual(["https://www.gymshark.com/men"]);
    expect(card.navPages).toEqual([{ url: "https://www.gymshark.com/men", title: "Men" }]);
  });

  it("prefers a YouTube channel link over an earlier video link", async () => {
    const html = `<html><body>
<a href="https://www.youtube.com/watch?v=abc123">Watch</a>
<a href="https://www.youtube.com/@rivalshop">YouTube</a>
<a href="https://www.youtube.com/c/rival">Older</a></body></html>`;
    const card = await extractIdentity(html, pageUrl);
    expect(card.socials.filter((s) => s.platform === "youtube")).toEqual([
      { platform: "youtube", url: "https://www.youtube.com/@rivalshop" },
    ]);
  });

  it("keeps the first YouTube link when none is a channel page", async () => {
    const html = `<html><body><a href="https://www.youtube.com/watch?v=one">One</a>
<a href="https://www.youtube.com/watch?v=two">Two</a></body></html>`;
    const card = await extractIdentity(html, pageUrl);
    expect(card.socials.map((s) => s.url)).toEqual(["https://www.youtube.com/watch?v=one"]);
  });
  it("reads sameAs from a second Organization inside @graph", async () => {
    const ld = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Rival" },
        { "@type": "Organization", name: "Rival" },
        { "@type": "Organization", sameAs: ["https://www.youtube.com/channel/UCoSvlWS5XcwaSzIcbuJ-Ysg"] },
      ],
    });
    const card = await extractIdentity(`<html><script type="application/ld+json">${ld}</script></html>`, pageUrl);
    expect(card.socials).toEqual([
      { platform: "youtube", url: "https://www.youtube.com/channel/UCoSvlWS5XcwaSzIcbuJ-Ysg" },
    ]);
  });

  it("ignores sameAs on a Person node in the graph", async () => {
    const ld = JSON.stringify({
      "@graph": [
        { "@type": "Organization", name: "Rival" },
        { "@type": "Person", sameAs: ["https://www.youtube.com/@author"] },
      ],
    });
    const card = await extractIdentity(`<html><script type="application/ld+json">${ld}</script></html>`, pageUrl);
    expect(card.socials).toEqual([]);
  });

  it("reads a social link from an inline footer JSON blob but not a CSP host", async () => {
    const html = `<html><script>{"classification":"youtube","label":"YouTube","type":"link","url":"https:\\/\\/www.youtube.com\\/user\\/rival"}</script>
<meta http-equiv="Content-Security-Policy" content="frame-src https://www.youtube.com"></html>`;
    const card = await extractIdentity(html, pageUrl);
    expect(card.socials).toEqual([{ platform: "youtube", url: "https://www.youtube.com/user/rival" }]);
  });

  it("finds a YouTube channel link inside script state when no anchor renders it", async () => {
    const html = `<html><script id="__NEXT_DATA__">{"footer":{"youtube":"https:\\u002F\\u002Fwww.youtube.com\\u002F@gymshark"}}</script></html>`;
    const card = await extractIdentity(html, pageUrl);
    expect(card.socials).toEqual([{ platform: "youtube", url: "https://www.youtube.com/@gymshark" }]);
  });

  it("ignores YouTube embed and watch links in script text", async () => {
    const html = `<html><script>var v="https://www.youtube.com/embed/abc123"; var w="https://www.youtube.com/watch?v=abc123"</script></html>`;
    const card = await extractIdentity(html, pageUrl);
    expect(card.socials).toEqual([]);
  });

  it("ignores a script-state YouTube link that is not named after the brand", async () => {
    const html = `<html><script>{"by":"https://www.youtube.com/@someoneelse"}</script></html>`;
    const card = await extractIdentity(html, pageUrl);
    expect(card.socials).toEqual([]);
  });

  it("matches the brand name on a two-part public suffix, not the suffix itself", async () => {
    const wrong = `<html><script>{"a":"https://www.youtube.com/@welcomeshop","b":"https://www.youtube.com/@comedyclub"}</script></html>`;
    expect((await extractIdentity(wrong, "https://www.brand.com.au/")).socials).toEqual([]);
    const right = `<html><script>{"a":"https://www.youtube.com/@brand"}</script></html>`;
    expect((await extractIdentity(right, "https://www.brand.co.uk/")).socials).toEqual([
      { platform: "youtube", url: "https://www.youtube.com/@brand" },
    ]);
  });

  it("needs the whole name, so a fan or sub-brand channel is ignored", async () => {
    const html = `<html><script>{"a":"https://www.youtube.com/@gymsharkfans","b":"https://www.youtube.com/@gymsharkwomen"}</script></html>`;
    expect((await extractIdentity(html, pageUrl)).socials).toEqual([]);
  });

  it("drops trailing punctuation from a link found in script text", async () => {
    const html = `<html><script>var t = "see https://www.youtube.com/@gymshark. Thanks";</script></html>`;
    expect((await extractIdentity(html, pageUrl)).socials).toEqual([
      { platform: "youtube", url: "https://www.youtube.com/@gymshark" },
    ]);
  });

  it("keeps a rendered anchor even when a script link has a better rank", async () => {
    const html = `<html><script>{"u":"https://www.youtube.com/@gymshark"}</script><a href="https://www.youtube.com/user/gymshark">YT</a></html>`;
    expect((await extractIdentity(html, pageUrl)).socials).toEqual([
      { platform: "youtube", url: "https://www.youtube.com/user/gymshark" },
    ]);
  });

  it("prefers a rendered channel anchor over a script-state user link", async () => {
    const html = `<html><script>{"u":"https://www.youtube.com/user/gymshark"}</script><a href="https://www.youtube.com/@gymshark">YT</a></html>`;
    const card = await extractIdentity(html, pageUrl);
    expect(card.socials).toEqual([{ platform: "youtube", url: "https://www.youtube.com/@gymshark" }]);
  });

  it("ignores script-state YouTube links on a social profile page", async () => {
    const html = `<html><script>{"u":"https://www.youtube.com/@instagram"}</script></html>`;
    const card = await extractIdentity(html, "https://www.instagram.com/someone/");
    expect(card.socials).toEqual([]);
  });
});
