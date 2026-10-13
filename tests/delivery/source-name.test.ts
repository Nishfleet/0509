import { describe, expect, it } from "vitest";

import { quietWeekSentence } from "../../app/lib/biggest-move";
import { platformName, sourceName } from "../../app/lib/source-name";

describe("a source's name in the brief (0509#4554)", () => {
  it("names a known platform in plain words, never the internal key", () => {
    expect(sourceName("mentions", "x")).toBe("X mentions");
    expect(sourceName("ads", "meta")).toBe("Meta ads");
    expect(sourceName("hiring", "greenhouse")).toBe("Greenhouse job posts");
    expect(sourceName("hiring", "lever")).toBe("Lever job posts");
    expect(sourceName("hiring", "ashby")).toBe("Ashby job posts");
    expect(sourceName("hiring", "workable")).toBe("Workable job posts");
    expect(sourceName("hiring", "smartrecruiters")).toBe("SmartRecruiters job posts");
  });

  it("falls back to the kind of source when the platform has no name yet", () => {
    expect(sourceName("mentions", "brand_new_network")).toBe("Your mentions source");
  });
});

describe("platformName", () => {
  it("gives customers the plain name of a source platform, never its internal key", () => {
    expect(["gdelt", "hn", "youtube", "web"].map(platformName)).toEqual(["News", "Hacker News", "YouTube", "Website"]);
  });

  it("falls back to plain words for a platform it has no name for", () => {
    expect(platformName("not-a-platform")).toBe("other sources");
  });

  it("reads as one sentence in the quiet-week line, with each name once", () => {
    const names = [...new Set(["gdelt", "web", "web", "odd", "other"].map(platformName))];
    expect(quietWeekSentence(names, null)).toContain("We watch News, Website, and other sources;");
  });
});
