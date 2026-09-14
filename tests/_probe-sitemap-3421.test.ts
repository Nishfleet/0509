import { describe, expect, it } from "vitest";

describe("probe", () => {
  it("prints the rendered sitemap entries for the new guide", async () => {
    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    const lines = (sitemap?.body ?? "").split("\n").filter((l) =>
      l.toLowerCase().includes("chatgpt"),
    );
    console.log("PROBE-BEGIN");
    for (const line of lines) console.log(line);
    console.log("PROBE-END");
    expect(lines.length).toBeGreaterThan(0);
  });
});
