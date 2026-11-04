import { describe, expect, it } from "vitest";

import { evidenceLine, isAiOnlyLine } from "../../../app/lib/discovery/evidence-line";
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

  it("marks a candidate only the ai proposer named as suggested", () => {
    expect(evidenceLine([{ sourceUrl: "https://gymshark.com/", excerpt: "", generator: "ai" }])).toBe(
      "We found this from your site's text. No news or forum mentions yet.",
    );
  });
});

describe("the AI-only evidence line", () => {
  const ai = { sourceUrl: "https://gymshark.com/", excerpt: "", generator: "ai" } as const;
  const news = { sourceUrl: "https://www.glamour.co.uk", excerpt: "a", generator: "news" } as const;
  const hn = { sourceUrl: "https://news.ycombinator.com/item?id=2", excerpt: "", generator: "hn" } as const;

  it("reads in plain words when every piece of evidence came from the site text", () => {
    expect(evidenceLine([ai, ai])).toBe("We found this from your site's text. No news or forum mentions yet.");
  });

  it("keeps the publisher wording once any outside source exists", () => {
    expect(evidenceLine([ai, news])).toBe("Named alongside you by 1 publisher");
    expect(evidenceLine([ai, hn])).toBe("Named alongside you in 1 Hacker News thread");
  });

  it("recognises the new and the old stored wording and nothing else", () => {
    expect(isAiOnlyLine(evidenceLine([ai]))).toBe(true);
    expect(isAiOnlyLine("Suggested from your site, not yet seen elsewhere")).toBe(true);
    expect(isAiOnlyLine("Named alongside you by 2 publishers")).toBe(false);
    expect(isAiOnlyLine("same buyer")).toBe(false);
    expect(isAiOnlyLine(null)).toBe(false);
  });
});
