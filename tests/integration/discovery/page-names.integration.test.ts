import { describe, expect, it } from "vitest";

import { readPageNames } from "../../../app/lib/discovery/page-names";

describe("readPageNames", () => {
  it("reads a trimmed og:site_name and leaves ld+json null", async () => {
    const html = '<meta property="og:site_name" content=" Gymshark ">';
    await expect(readPageNames(html)).resolves.toEqual({
      ogSiteName: "Gymshark",
      ldOrganizationName: null,
    });
  });

  it("reads Organization.name from an ld+json object", async () => {
    const html = `<script type="application/ld+json">{"@type":"Organization","name":"Alphalete Athletics"}</script>`;
    await expect(readPageNames(html)).resolves.toEqual({
      ogSiteName: null,
      ldOrganizationName: "Alphalete Athletics",
    });
  });

  it("reads the Organization node inside an @graph, skipping a leading WebSite", async () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Not The Brand" },
        { "@type": "Organization", name: "Graph Brand" },
      ],
    })}</script>`;
    await expect(readPageNames(html)).resolves.toEqual({
      ogSiteName: null,
      ldOrganizationName: "Graph Brand",
    });
  });

  it("reads a node whose @type array includes Organization", async () => {
    const html = `<script type="application/ld+json">${JSON.stringify([
      { "@type": ["Organization", "Brand"], name: "Dual Type Brand" },
    ])}</script>`;
    await expect(readPageNames(html)).resolves.toEqual({
      ogSiteName: null,
      ldOrganizationName: "Dual Type Brand",
    });
  });

  it("skips a malformed script and reads the following valid Organization", async () => {
    const html = [
      '<script type="application/ld+json">{not json</script>',
      '<script type="application/ld+json">{"@type":"Organization","name":"Valid After Bad"}</script>',
    ].join("");
    await expect(readPageNames(html)).resolves.toEqual({
      ogSiteName: null,
      ldOrganizationName: "Valid After Bad",
    });
  });

  it("returns both null when neither signal is present", async () => {
    await expect(readPageNames("<html><head><title>plain</title></head></html>")).resolves.toEqual({
      ogSiteName: null,
      ldOrganizationName: null,
    });
  });
});
