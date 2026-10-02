import { describe, expect, it } from "vitest";

import { countPhrase } from "../../workers/delivery/brief-template";

describe("countPhrase", () => {
  it("says no for zero, with the plural noun", () => {
    expect(countPhrase(0, "mention", "mentions")).toBe("no mentions");
    expect(countPhrase(0, "site change", "site changes")).toBe("no site changes");
    expect(countPhrase(0, "new ad", "new ads")).toBe("no new ads");
  });

  it("says 1 with the singular noun", () => {
    expect(countPhrase(1, "mention", "mentions")).toBe("1 mention");
    expect(countPhrase(1, "site change", "site changes")).toBe("1 site change");
    expect(countPhrase(1, "new ad", "new ads")).toBe("1 new ad");
  });

  it("uses the plural noun for every other count", () => {
    expect(countPhrase(2, "mention", "mentions")).toBe("2 mentions");
    expect(countPhrase(2, "site change", "site changes")).toBe("2 site changes");
    expect(countPhrase(2, "new job post", "new job posts")).toBe("2 new job posts");
  });

  it("renders a large count as the bare number n produces, with the plural noun", () => {
    expect(countPhrase(1234, "mention", "mentions")).toBe("1234 mentions");
  });
});
