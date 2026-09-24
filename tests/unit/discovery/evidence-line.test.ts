import { describe, expect, it } from "vitest";

import { evidenceLine } from "../../../app/lib/discovery/evidence-line";
import { noulAction } from "../../../app/lib/jev/thresholds";

describe("evidenceLine", () => {
  it("counts distinct publishers and Hacker News threads", () => {
    expect(
      evidenceLine([
        { sourceUrl: "https://www.glamour.co.uk", excerpt: "a", generator: "news" },
        { sourceUrl: "https://glamour.co.uk", excerpt: "b", generator: "news" },
        { sourceUrl: "https://www.gq-magazine.co.uk", excerpt: "c", generator: "news" },
        { sourceUrl: "https://news.ycombinator.com/item?id=1", excerpt: "d", generator: "hn" },
      ]),
    ).toBe("Named alongside you by 2 publishers and in 1 Hacker News thread");
  });

  it("still says where the name came from with no countable source", () => {
    expect(evidenceLine([])).toBe("Named alongside you online");
  });
});

describe("noulAction", () => {
  it("acts at exactly 0.9, rejects at exactly 0.1, and asks in between", () => {
    expect(noulAction(0.9)).toBe("act");
    expect(noulAction(0.1)).toBe("reject");
    expect(noulAction(0.5)).toBe("maybe");
  });
});
