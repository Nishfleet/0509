import { describe, expect, it } from "vitest";

import { legalMeta } from "../../app/lib/legal/meta";
import { PRIVACY } from "../../app/lib/legal/privacy";
import { TERMS } from "../../app/lib/legal/terms";

// 0509#5758 / audit V18: /privacy declared `robots` from its own route and
// /terms declared none, so the two legal pages carried two different crawler
// policies and the sitemap lists both. The entry lives in the shared helper
// now, so this asserts one policy for both rather than one page's tag.
describe("legal page meta", () => {
  it("gives /privacy and /terms the same single robots policy", () => {
    for (const doc of [PRIVACY, TERMS]) {
      const robots = legalMeta(doc).filter((entry) => entry.name === "robots");
      expect(robots).toEqual([{ name: "robots", content: "index, follow" }]);
    }
  });
});
