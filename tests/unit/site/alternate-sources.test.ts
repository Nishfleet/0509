import { describe, expect, it } from "vitest";

import { offBrandSite, ownHostUrls } from "../../../app/lib/site/alternate-sources";
import { provenanceNote } from "../../../app/lib/site-change";

describe("alternate sources for a blocked rival", () => {
  it("tries only the brand's own news, newsroom and press hosts", () => {
    expect(ownHostUrls("www.adidas.com")).toEqual([
      "https://news.adidas.com/",
      "https://newsroom.adidas.com/",
      "https://press.adidas.com/",
    ]);
    expect(ownHostUrls("localhost")).toEqual([]);
  });

  it("names a page's site only when it is not the brand's own", () => {
    expect(offBrandSite("https://news.adidas-group.com/", "adidas.com")).toBe("adidas-group.com");
    expect(offBrandSite("https://news.adidas.com/", "www.adidas.com")).toBeNull();
  });

  it("words the provenance note", () => {
    expect(provenanceNote({ viaArchive: false, seenOn: null })).toBeNull();
    expect(provenanceNote({ viaArchive: false, seenOn: "adidas-group.com" })).toBe("Seen on adidas-group.com");
    expect(provenanceNote({ viaArchive: true, seenOn: null })).toBe("From a public archive copy");
    expect(provenanceNote({ viaArchive: true, seenOn: "adidas-group.com" })).toBe(
      "Seen on adidas-group.com · From a public archive copy",
    );
  });
});
