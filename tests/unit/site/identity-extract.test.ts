import { describe, expect, it } from "vitest";

import { extractIdentity, identityExtractSchema } from "../../../app/lib/identity/extract";
import { extractPageText } from "../../../app/lib/site/extract-text";
import gym from "../../fixtures/gymshark-2026-09-22-a.html?raw";

const pageUrl = "https://www.gymshark.com/";

describe("extractIdentity", () => {
  it("reads the Gymshark homepage into the identity card fields", async () => {
    const card = identityExtractSchema.parse(await extractIdentity(gym, pageUrl));

    expect(card.nameSources.ogSiteName).toBe("Gymshark");
    expect(card.nameSources.ldOrganizationName).toBe("Gymshark");
    expect(card.ldOrganizationLogo).toContain(
      "images.ctfassets.net/wl6q2in9o7k3/QN3GChnXFjOolrl6zNQBp/",
    );
    expect(card.ldOrganizationLogo).toContain("Gymshark_Combi_Logo_Black.png");
    expect(card.socials.map((social) => social.platform).sort()).toEqual([
      "facebook",
      "instagram",
      "tiktok",
      "twitter",
      "youtube",
    ]);
    expect(card.manifestUrl).toBe("https://www.gymshark.com/site.webmanifest");
    expect(card.appleTouchIcon).toBe("https://www.gymshark.com/apple-touch-icon.png");
    expect(card.text).toBe((await extractPageText(gym)).text);
  });

  it("keeps a title that arrives in more than one chunk", async () => {
    const card = await extractIdentity(`<title>${"a".repeat(70_000)}</title>`, pageUrl);

    expect(card.nameSources.title).toHaveLength(70_000);
  });

  it("skips an ld+json block that is not JSON", async () => {
    await expect(
      extractIdentity('<script type="application/ld+json">{not json</script>', pageUrl),
    ).resolves.toBeDefined();
  });
});
