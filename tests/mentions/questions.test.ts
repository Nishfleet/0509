import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { RecentSignal } from "../../app/lib/data/signal.server";
import { STILL_COMPETITOR, stillCompetitorState } from "../../app/lib/discovery/refresh.server";
import { ABOUT_BRAND, MATTERS, mentionMattersState } from "../../app/lib/mentions/questions";

describe("mention and retire questions (0509#7084)", () => {
  it("tells Jev to use the mention date so old news is not a new alert", () => {
    expect(MATTERS.instructions).toContain("published_at");
    expect(MATTERS.instructions).toContain("`today`");
    expect(MATTERS.instructions).toMatch(/more than 7 days before `today`/);
    expect(MATTERS.instructions).toMatch(/missing, judge from the item content/);
    expect(ABOUT_BRAND.instructions).not.toMatch(/regex|pattern/i);
  });

  it("sends today's date in the state of the question", () => {
    const state = mentionMattersState({
      self: { name: "Nike", domain: "nike.com", description: null },
      subject: { name: "Adidas", domain: "adidas.com", role: "competitor" },
      competitors: [],
      item: { title: "Adidas raises prices", url: "https://example.com/a", publishedAt: null },
      reliability: "rss",
      today: "2026-10-06",
    });
    expect(state).toMatchObject({ today: "2026-10-06", item: { published_at: null } });
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
    expect(rows.map((row) => row.id)).toContain("adv-injected-instruction-in-page-change");
  });

  it("keeps the injected instruction of the adversarial still_competitor case in the judged state", () => {
    const rows = JSON.parse(readFileSync("tests/evals/cases/still_competitor.json", "utf8")) as {
      id: string;
      history: RecentSignal[];
      labelChoice: string;
    }[];
    const row = rows.find((entry) => entry.id === "adv-injected-instruction-in-page-change");
    const context = {
      self: { workspaceId: "w", name: "Notion", domain: "notion.so", description: null, kind: "domain" },
      competitors: [],
      knownDomains: [],
      dismissedDomains: [],
    } as const;
    const target = { entityId: "e", name: "ClickUp", domain: "clickup.com", origin: "auto" } as const;

    const state = stillCompetitorState(context, target, row?.history ?? []) as { history_30d: RecentSignal[] };

    expect(state.history_30d.map((signal) => signal.summary).join(" ")).toMatch(/ignore previous instructions/);
    expect(row?.labelChoice).toBe("active");
  });
});
