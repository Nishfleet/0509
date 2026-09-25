import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AlertFeed } from "../../app/components/alert-feed";
import type { AlertFeedItem } from "../../app/components/alert-row";
import { MentionRow } from "../../app/components/mention-row";
import {
  mentionsFromRows,
  mentionTreatment,
  mentionWhen,
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
    id: overrides.id,
    p: overrides.p,
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

  it("keeps unjudged rows as unreviewed, drops empty titles, and keeps the stored reason instead of the score", () => {
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
    expect(mentions.map((mention) => mention.treatment)).toEqual([
      "shown",
      "possibly",
      "held",
      "unreviewed",
      "shown",
    ]);
    expect(mentions.map((mention) => mention.sourceName)).toEqual([
      "News mentions",
      "Hacker News mentions",
      "Medium mentions",
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
    expect(html).toContain("A London flagship is a move worth knowing.");
    expect(html).toContain("A roundup mention, not a move of its own.");
    expect(html).toContain("A ticker line, not a move.");
    expect(html.match(/data-treatment="possibly"/g)).toHaveLength(1);
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
      createElement(AlertFeed, { groups: [{ group: "New", items: mentions.map(item) }] }),
    );
    expect(html).toContain("Zephyrwear opens a London flagship");
    expect(html).not.toContain("Zephyrwear ticker line");
    expect(html).toContain("Show all");
    expect(showInFeed(item(mentions[1] as MentionRowModel), false)).toBe(false);
    expect(showInFeed(item(mentions[1] as MentionRowModel), true)).toBe(true);
    expect(html).not.toMatch(BANNED);
  });
});
