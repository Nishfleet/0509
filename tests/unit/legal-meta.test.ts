import { describe, expect, it } from "vitest";

import { legalMeta } from "../../app/lib/legal/meta";
import { PRIVACY } from "../../app/lib/legal/privacy";
import { TERMS } from "../../app/lib/legal/terms";

describe("legal page meta", () => {
  it("gives /privacy and /terms the same single robots policy", () => {
    for (const doc of [PRIVACY, TERMS]) {
      const metaEntries: Record<string, unknown>[] = legalMeta(doc);
      const robots = metaEntries.filter((entry) => entry.name === "robots");
      expect(robots).toEqual([{ name: "robots", content: "index, follow" }]);
    }
  });

  it("gives both pages a social card that matches their own title, description and url", () => {
    for (const doc of [PRIVACY, TERMS]) {
      const tags: Record<string, unknown>[] = legalMeta(doc);
      const og = (property: string) => tags.find((entry) => entry.property === property)?.content;
      expect(og("og:title")).toBe(`${doc.title} · Five to Nine`);
      expect(og("og:description")).toBe(doc.description);
      expect(og("og:url")).toBe(`https://0509.io${doc.path}`);
      expect(og("og:image")).toBe("https://0509.io/og.png");
      expect(tags).toContainEqual({ name: "twitter:card", content: "summary_large_image" });
    }
  });
});
