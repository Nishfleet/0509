import { describe, expect, it } from "vitest";

import { publicSeoFileForPathname } from "~/lib/seo";

describe("public SEO files", () => {
  it("does not publish dynamic search in the public sitemap", () => {
    const sitemap = publicSeoFileForPathname("/sitemap.xml");

    expect(sitemap?.body).toContain("https://0509.in/");
    expect(sitemap?.body).toContain("https://0509.in/privacy");
    expect(sitemap?.body).toContain("https://0509.in/terms");
    expect(sitemap?.body).not.toContain("https://0509.in/search");
  });
});
