import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { publicSeoFileForPathname } from "~/lib/seo";

describe("public SEO files", () => {
  it("does not publish dynamic search in the public sitemap", () => {
    const sitemap = publicSeoFileForPathname("/sitemap.xml");

    expect(sitemap?.body).toContain("https://0509.io/");
    expect(sitemap?.body).toContain("https://0509.io/privacy");
    expect(sitemap?.body).toContain("https://0509.io/terms");
    expect(sitemap?.body).not.toContain("https://0509.io/search");
  });

  it("keeps security.txt canonical and contact addresses on the io domain", () => {
    const rootSecurity = readFileSync("public/security.txt", "utf8");
    const wellKnownSecurity = readFileSync("public/.well-known/security.txt", "utf8");

    expect(wellKnownSecurity).toBe(rootSecurity);
    expect(rootSecurity).toContain("Contact: mailto:support@0509.io");
    expect(rootSecurity).toContain("Canonical: https://0509.io/.well-known/security.txt");
    expect(rootSecurity).not.toContain("0509.in");
  });
});
