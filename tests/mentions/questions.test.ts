import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { STILL_COMPETITOR } from "../../app/lib/discovery/refresh.server";
import { ABOUT_BRAND, MATTERS } from "../../app/lib/mentions/questions";

describe("mention and retire questions (0509#7084)", () => {
  it("tells Jev to use the mention date so old news is not a new alert", () => {
    expect(MATTERS.instructions).toContain("published_at");
    expect(MATTERS.instructions).toMatch(/older than this week/i);
    expect(ABOUT_BRAND.instructions).not.toMatch(/regex|pattern/i);
  });

  it("tells Jev to ignore a third-party headline when deciding whether to retire a rival", () => {
    expect(STILL_COMPETITOR.instructions).toMatch(/third-party headline/i);
  });

  it("keeps adversarial mention_matters cases in the eval suite", () => {
    const rows = JSON.parse(readFileSync("tests/evals/cases/mention_matters.json", "utf8")) as { id: string }[];
    expect(rows.map((row) => row.id)).toEqual(expect.arrayContaining(["adv-old-news-2013", "adv-ignore-instructions"]));
  });

  it("keeps adversarial still_competitor cases in the eval suite", () => {
    const rows = JSON.parse(readFileSync("tests/evals/cases/still_competitor.json", "utf8")) as { id: string }[];
    expect(rows.map((row) => row.id)).toContain("adv-headline-claims-shutdown");
  });
});
