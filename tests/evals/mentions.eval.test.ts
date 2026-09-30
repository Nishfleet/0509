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
import { formatReport, jevKeyPresent, loadCasesAs, makeAsk, runEval, type Ask, type EvalCaseBase } from "./harness";

/**
 * The two mention questions, scored on the shipped wording.
 *
 * The question constants and both state builders come from app/lib, which is
 * what workers/mentions/sweep.ts itself asks, so a wording edit and the eval
 * that measures it move together (0509#6163).
 */

interface MentionCase extends EvalCaseBase {
  self: MentionSelf;
  subject: MentionSubject;
  competitors: { name: string; domain: string }[];
  item: MentionItemInput;
  reliability: string;
}

function parseMentionCase(raw: Record<string, unknown>, index: number): MentionCase {
  const row = raw as unknown as MentionCase;
  if (typeof row.self?.name !== "string" || typeof row.self?.domain !== "string") {
    throw new Error(`case ${index} has no self`);
  }
  if (typeof row.subject?.name !== "string" || typeof row.subject?.domain !== "string") {
    throw new Error(`case ${index} has no subject`);
  }
  if (typeof row.subject?.role !== "string") throw new Error(`case ${index} has no subject.role`);
  if (typeof row.item?.title !== "string" || typeof row.item?.url !== "string") {
    throw new Error(`case ${index} has no item`);
  }
  if (typeof row.item?.publishedAt !== "string") throw new Error(`case ${index} has no item.publishedAt`);
  if (!Array.isArray(row.competitors)) throw new Error(`case ${index} has no competitors`);
  if (typeof row.reliability !== "string") throw new Error(`case ${index} has no reliability`);
  return row;
}

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
    const askOne = await makeAsk(ABOUT_BRAND);
    const ask: Ask<MentionCase> = async (row) =>
      askOne(aboutBrandState({ subject: row.subject, item: row.item, reliability: row.reliability }));
    const report = await runEval(
      "mention_is_about_brand",
      ask,
      await loadCasesAs("mention_is_about_brand", parseMentionCase),
    );
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });

  it("mention_matters: scores the shipped MATTERS text on both splits", async () => {
    const askOne = await makeAsk(MATTERS);
    const ask: Ask<MentionCase> = async (row) =>
      askOne(
        mentionMattersState({
          self: row.self,
          subject: row.subject,
          competitors: row.competitors,
          item: row.item,
          reliability: row.reliability,
        }),
      );
    const report = await runEval("mention_matters", ask, await loadCasesAs("mention_matters", parseMentionCase));
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
