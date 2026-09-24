import { describe, expect, it } from "vitest";

import { sourceName } from "../../app/lib/source-name";

describe("a source's name in the brief (0509#4554)", () => {
  it("names a known platform in plain words, never the internal key", () => {
    expect(sourceName("mentions", "x")).toBe("X mentions");
    expect(sourceName("ads", "meta")).toBe("Meta ads");
    expect(sourceName("hiring", "greenhouse")).toBe("Greenhouse job posts");
  });

  it("falls back to the kind of source when the platform has no name yet", () => {
    expect(sourceName("mentions", "brand_new_network")).toBe("Your mentions source");
  });
});
