import { describe, expect, it } from "vitest";

import {
  ABOUT_BRAND,
  aboutBrandState,
  MATTERS,
  mentionMattersState,
  type MentionItemInput,
  type MentionSelf,
  type MentionSubject,
} from "../../app/lib/mentions/questions";
import {
  formatReport,
  jevKeyPresent,
  loadCases,
  makeNoulAsk,
  noulScore,
  runEval,
  type Ask,
  type NoulEvalRow,
} from "./harness";

/**
 * The two mention questions, scored on the shipped wording.
 *
 * The question constants and both state builders come from app/lib, which is
 * what workers/mentions/sweep.ts itself asks, so a wording edit and the eval
 * that measures it move together (0509#6163).
 */

interface MentionCase extends NoulEvalRow {
  self: MentionSelf;
  subject: MentionSubject;
  competitors: { name: string; domain: string }[];
  item: MentionItemInput;
  reliability: string;
}

const MENTION_FIELDS = ["self", "subject", "competitors", "item", "reliability"] as const;

describe("mention question state builders", () => {
  it("aboutBrandState packs exactly the state the sweep sends Jev", () => {
    expect(
      aboutBrandState({
        subject: { name: "Adidas", domain: "adidas.com", role: "competitor" },
        item: {
          title: "Adidas raises prices",
          url: "https://example.com/a",
          publishedAt: "2026-09-20",
          publisher: null,
        },
        reliability: "rss",
      }),
    ).toEqual({
      subject: { name: "Adidas", domain: "adidas.com", role: "competitor" },
      item: {
        title: "Adidas raises prices",
        publisher: null,
        url: "https://example.com/a",
        published_at: "2026-09-20",
        reliability: "rss",
      },
    });
  });

  it("mentionMattersState packs exactly the state the sweep sends Jev", () => {
    expect(
      mentionMattersState({
        self: { name: "Nike", domain: "nike.com", description: "sportswear" },
        subject: { name: "Adidas", domain: "adidas.com", role: "competitor" },
        competitors: [{ name: "Puma", domain: "puma.com" }],
        item: {
          title: "Adidas raises prices",
          url: "https://example.com/a",
          publishedAt: "2026-09-20",
          publisher: "gq.com",
        },
        reliability: "rss",
      }),
    ).toEqual({
      self: { name: "Nike", domain: "nike.com", description: "sportswear" },
      subject: { name: "Adidas", domain: "adidas.com", role: "competitor" },
      competitor_set: [{ name: "Puma", domain: "puma.com" }],
      item: {
        title: "Adidas raises prices",
        publisher: "gq.com",
        url: "https://example.com/a",
        published_at: "2026-09-20",
        reliability: "rss",
      },
    });
  });
});

describe.skipIf(!jevKeyPresent())("eval: mention questions against Jev", () => {
  it("mention_is_about_brand: scores the shipped ABOUT_BRAND text on both splits", async () => {
    const rows = await loadCases<MentionCase>("mention_is_about_brand", MENTION_FIELDS);
    const askOne = makeNoulAsk(ABOUT_BRAND);
    const ask: Ask<MentionCase> = (row) =>
      askOne(aboutBrandState({ subject: row.subject, item: row.item, reliability: row.reliability }));
    const report = await runEval("mention_is_about_brand", rows, ask, noulScore);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });

  it("mention_matters: scores the shipped MATTERS text on both splits", async () => {
    const rows = await loadCases<MentionCase>("mention_matters", MENTION_FIELDS);
    const askOne = makeNoulAsk(MATTERS);
    const ask: Ask<MentionCase> = (row) =>
      askOne(
        mentionMattersState({
          self: row.self,
          subject: row.subject,
          competitors: row.competitors,
          item: row.item,
          reliability: row.reliability,
        }),
      );
    const report = await runEval("mention_matters", rows, ask, noulScore);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
