import { describe, expect, it } from "vitest";

import { isAboutBrand } from "../app/lib/jev/thresholds";

describe("isAboutBrand", () => {
  it.each([
    ["Jev plays Roulette Wars on its own", 0.2276],
    ["List of April Fools RFCs", 0.1633],
    ["Show HN: A local alternative to Jev", 0.3431],
    ["Flock: A Flock of Birds in your Browser", 0.1929],
    ["Libron E-Reader Font", 0.1378],
    ["Dataviz: Most mentioned companies in the NYT since 01/01/2000", 0.1099],
    ["lowest score the old line kept", 0.1015],
  ])("drops %s at p %s", (_title, p) => {
    expect(isAboutBrand(p)).toBe(false);
  });

  it("keeps a mention the judge is at least half sure is about the brand", () => {
    expect(isAboutBrand(0.5)).toBe(true);
    expect(isAboutBrand(0.93)).toBe(true);
  });
});
