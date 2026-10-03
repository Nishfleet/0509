import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AlertFeed } from "../../app/components/alert-feed";
import type { AlertFeedItem } from "../../app/components/alert-row";
import { MentionRow } from "../../app/components/mention-row";
import {
  alsoReportedLine,
  mentionsFromRows,
  mentionTreatment,
  mentionWhen,
  PENDING_LINE,
  showInFeed,
  withoutMentionAlerts,
  type MentionReadRow,
  type MentionRowModel,
} from "../../app/lib/mention-feed";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const POSSIBLY = "Possibly. We were not sure this mattered, so it sits here rather than in your brief.";
const BANNED = /probability|confidence|mention_matters|mention_is_about_brand|\b0\.\d{2,}\b/i;

function row(overrides: Partial<MentionReadRow> & Pick<MentionReadRow, "id" | "p">): MentionReadRow {
  return {
    title: overrides.title ?? "Zephyrwear opens a London flagship",
    url: overrides.url ?? "https://news.example/flagship",
    platform: overrides.platform ?? "gdelt",
    kind: overrides.kind ?? "mentions",
    publishedAt: overrides.publishedAt === undefined ? "2026-09-24T08:00:00.000Z" : overrides.publishedAt,
    observedAt: overrides.observedAt ?? "2026-09-25T08:00:00.000Z",
    reason: overrides.reason === undefined ? "A London flagship is a move worth knowing." : overrides.reason,
    verdictId: overrides.verdictId === undefined ? `v-${overrides.id}` : overrides.verdictId,
    verdictDecidedAt:
      overrides.verdictDecidedAt === undefined ? "2026-09-25T09:00:00.000Z" : overrides.verdictDecidedAt,
    id: overrides.id,
    p: overrides.p,
    state: overrides.state ?? null,
    alsoCount: overrides.alsoCount ?? 0,
  };
}

function item(mention: MentionRowModel): AlertFeedItem {
  return { kind: "mention", id: mention.id, at: mention.observedAt, mention };
}

describe("mentions feed", () => {
  it("puts p >= 0.9 in the feed, the middle band on possibly, and p <= 0.1 behind show all", () => {
    expect(mentionTreatment(0.9)).toBe("shown");
    expect(mentionTreatment(1)).toBe("shown");
    expect(mentionTreatment(0.5)).toBe("possibly");
    expect(mentionTreatment(0.11)).toBe("possibly");
    expect(mentionTreatment(0.1)).toBe("held");
    expect(mentionTreatment(0)).toBe("held");
  });

  it("says found today when published_at is null and a relative time otherwise", () => {
    expect(mentionWhen(null, NOW)).toBe("found today");
    expect(mentionWhen("2026-09-23T00:00:00.000Z", NOW)).toBe("2 days ago");
  });

  it("keeps unstated rows as unreviewed, drops empty titles, and keeps the stored reason instead of the score", () => {
    const mentions = mentionsFromRows(
      [
        row({ id: "high", p: 0.95, platform: "gdelt" }),
        row({
          id: "mid",
          p: 0.42,
          platform: "hn",
          publishedAt: null,
          title: "Zephyrwear shows up in a roundup",
          reason: "A roundup mention, not a move of its own.",
        }),
        row({
          id: "low",
          p: 0.05,
          platform: "medium",
          title: "Zephyrwear ticker line",
          reason: "A ticker line, not a move.",
        }),
        row({ id: "unjudged", p: null, title: "No verdict yet", reason: "Should not appear." }),
        row({ id: "blank", p: 0.95, title: "  ", reason: "Should not appear." }),
        row({ id: "blank-reason", p: 0.92, title: "A bare headline", reason: "   " }),
      ],
      NOW,
    );
    expect(mentions.map((mention) => mention.id)).toEqual(["high", "mid", "low", "unjudged", "blank-reason"]);
    expect(mentions.map((mention) => mention.treatment)).toEqual(["shown", "possibly", "held", "unreviewed", "shown"]);
    expect(mentions.map((mention) => mention.sourceName)).toEqual([
      "News mentions",
      "Hacker News mentions",
      "Medium mentions",
      "News mentions",
      "News mentions",
    ]);
    expect(mentions[1]?.when).toBe("found today");
    expect(mentions.map((mention) => mention.why)).toEqual([
      "A London flagship is a move worth knowing.",
      "A roundup mention, not a move of its own.",
      "A ticker line, not a move.",
      "Should not appear.",
      null,
    ]);
    expect(mentions.every((mention) => !("p" in mention))).toBe(true);
    expect(JSON.stringify(mentions)).not.toMatch(BANNED);
  });

  it("does not also show the mention alert row the sweep wrote for a high score", () => {
    expect(
      withoutMentionAlerts([
        { kind: "mention", id: "mention-sig" },
        { kind: "ad", id: "ad-sig" },
      ]).map((signal) => signal.id),
    ).toEqual(["ad-sig"]);
  });

  it("renders the three treatments with a source pill, a time, and the stored reason behind the tap", () => {
    const mentions = mentionsFromRows(
      [
        row({ id: "high", p: 0.95 }),
        row({
          id: "mid",
          p: 0.42,
          platform: "hn",
          publishedAt: null,
          title: "Zephyrwear shows up in a roundup",
          reason: "A roundup mention, not a move of its own.",
        }),
        row({
          id: "low",
          p: 0.04,
          platform: "medium",
          title: "Zephyrwear ticker line",
          reason: "A ticker line, not a move.",
        }),
      ],
      NOW,
    );
    const html = mentions.map((mention) => renderToStaticMarkup(createElement(MentionRow, { mention }))).join("");
    expect(html).toContain('data-treatment="shown"');
    expect(html).toContain('data-treatment="possibly"');
    expect(html).toContain('data-treatment="held"');
    expect(html).toContain("News mentions");
    expect(html).toContain("Hacker News mentions");
    expect(html).toContain("Medium mentions");
    expect(html).toContain("found today");
    expect(html).toContain(POSSIBLY);
    expect(html).toContain("Why we flagged this");
    expect(mentions.map((mention) => mention.whyFlagged?.reason ?? null)).toEqual([
      "A London flagship is a move worth knowing.",
      "A roundup mention, not a move of its own.",
      "A ticker line, not a move.",
    ]);
    expect(html).not.toContain("A London flagship is a move worth knowing.");
    expect(html).not.toContain("A roundup mention, not a move of its own.");
    expect(html).not.toContain("A ticker line, not a move.");
    expect(html.match(/data-treatment="possibly"/g)).toHaveLength(1);
    expect(html).not.toMatch(BANNED);
  });

  it("builds the whyFlagged sheet from the stored verdict id and time, and leaves it null without them", () => {
    const flagged = mentionsFromRows(
      [
        row({
          id: "v1",
          p: 0.95,
          title: "Zephyrwear opens a London flagship",
          reason: "A move.",
          verdictId: "v-1",
          verdictDecidedAt: "2026-09-20T10:00:00.000Z",
        }),
      ],
      NOW,
    )[0] as MentionRowModel;
    expect(flagged.whyFlagged).not.toBeNull();
    expect(flagged.whyFlagged?.verdictId).toBe("v-1");
    expect(flagged.whyFlagged?.sure).toBe("95%");
    expect(flagged.whyFlagged?.decision).toBe("Flagged");
    expect(flagged.whyFlagged?.reason).toBe("A move.");

    const unjudged = mentionsFromRows(
      [
        row({
          id: "v0",
          p: 0.95,
          title: "Zephyrwear without a verdict",
          reason: "Reason but no verdict row.",
          verdictId: null,
          verdictDecidedAt: "2026-09-20T10:00:00.000Z",
        }),
      ],
      NOW,
    )[0] as MentionRowModel;
    expect(unjudged.whyFlagged).toBeNull();
  });

  it("shows a judged mention and a pending one, the unjudged row labelled as still being checked", () => {
    const mentions = mentionsFromRows(
      [
        row({ id: "judged", p: 0.95, title: "Zephyrwear opens a London flagship", state: "judged" }),
        row({ id: "unjudged", p: null, title: "Zephyrwear in a roundup", state: "unjudged", reason: null }),
      ],
      NOW,
    );
    expect(mentions.map((mention) => mention.treatment)).toEqual(["shown", "pending"]);
    const html = renderToStaticMarkup(
      createElement(AlertFeed, { groups: [{ group: "Today", items: mentions.map(item) }] }),
    );
    expect(html.match(/data-testid="mention-row"/g)).toHaveLength(2);
    expect(html).toContain('data-treatment="shown"');
    expect(html).toContain('data-treatment="pending"');
    expect(html).toContain(PENDING_LINE);
    expect(html).toContain("Still being checked");
    expect(html).toContain("bg-bone");
    expect(html).not.toMatch(/data-treatment="pending"[^>]*bg-card/);
    expect(html).not.toMatch(BANNED);
  });

  it("keeps the low band out of the default feed until show all", () => {
    const mentions = mentionsFromRows(
      [
        row({ id: "high", p: 0.95 }),
        row({ id: "low", p: 0.04, title: "Zephyrwear ticker line", reason: "A ticker line, not a move." }),
      ],
      NOW,
    );
    const html = renderToStaticMarkup(
      createElement(AlertFeed, { groups: [{ group: "Today", items: mentions.map(item) }] }),
    );
    expect(html).toContain("Zephyrwear opens a London flagship");
    expect(html).not.toContain("Zephyrwear ticker line");
    expect(html).toContain("Show all");
    expect(showInFeed(item(mentions[1] as MentionRowModel), false)).toBe(false);
    expect(showInFeed(item(mentions[1] as MentionRowModel), true)).toBe(true);
    expect(html).not.toMatch(BANNED);
  });

  it("renders mention titles in the house row-name type, never the old text-lg font-semibold", () => {
    const mentions = mentionsFromRows([row({ id: "shown-1", p: 0.95 })], NOW);
    const html = renderToStaticMarkup(createElement(MentionRow, { mention: mentions[0] }));
    expect(html).toContain('<h3 class="font-display text-row-name font-bold [overflow-wrap:anywhere]">');
    expect(html).not.toContain("text-lg font-semibold");
  });

  it("shows also reported by N other sources only when a collapsed copy exists, never a probability", () => {
    const [none] = mentionsFromRows([row({ id: "m1", p: 0.95 })], NOW);
    const [one] = mentionsFromRows([row({ id: "m2", p: 0.95, alsoCount: 1 })], NOW);
    const [two] = mentionsFromRows([row({ id: "m3", p: 0.95, alsoCount: 2 })], NOW);
    expect(none?.alsoCount).toBe(0);
    expect(renderToStaticMarkup(createElement(MentionRow, { mention: none as MentionRowModel }))).not.toContain(
      "Also reported",
    );
    expect(renderToStaticMarkup(createElement(MentionRow, { mention: one as MentionRowModel }))).toContain(
      "Also reported by 1 other source<",
    );
    expect(alsoReportedLine(2)).toBe("Also reported by 2 other sources");
    const html = renderToStaticMarkup(createElement(MentionRow, { mention: two as MentionRowModel }));
    expect(html).toContain("Also reported by 2 other sources");
    expect(html).not.toMatch(BANNED);
  });
});
