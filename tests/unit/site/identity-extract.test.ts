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
    expect(card.ldOrganizationLogo).toContain(
      "images.ctfassets.net/wl6q2in9o7k3/QN3GChnXFjOolrl6zNQBp/",
    );
    expect(card.ldOrganizationLogo).toContain("Gymshark_Combi_Logo_Black.png");
    expect(card.socials).toEqual([
      { platform: "facebook", url: "https://www.facebook.com/Gymshark/" },
      { platform: "twitter", url: "https://twitter.com/Gymshark" },
      { platform: "instagram", url: "https://www.instagram.com/gymshark/" },
      { platform: "youtube", url: "http://www.youtube.com/@gymshark" },
      { platform: "tiktok", url: "https://www.tiktok.com/@gymshark" },
    ]);
    expect(card.navLinks).toContain("https://www.gymshark.com/blog");
    expect(
      card.navLinks.every((link) => link.startsWith("https://www.gymshark.com/")),
    ).toBe(true);
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
    const card = await extractIdentity(
      '<script type="application/ld+json">{not json</script>',
      pageUrl,
    );

    expect(card.nameSources.ldOrganizationName).toBeNull();
  });

  it("falls back to the meta description when og:description is absent", async () => {
    const card = await extractIdentity(
      '<meta name="description" content="meta description only">',
      pageUrl,
    );

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
});
