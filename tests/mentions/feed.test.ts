import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AlertFeed } from "../../app/components/alert-feed";
import type { AlertFeedItem } from "../../app/components/alert-row";
import { MentionRow } from "../../app/components/mention-row";
import {
  FOUND_TODAY,
  MENTION_FEED_SQL,
  POSSIBLY_LINE,
  mentionFeedBinds,
  mentionTreatment,
  mentionWhen,
  mentionWhy,
  mentionsFromRows,
  showInFeed,
  visibleMentions,
  withoutMentionAlerts,
  type MentionReadRow,
  type MentionRowModel,
} from "../../app/lib/mention-feed";
import { D6_QUESTION_ID } from "../../app/lib/standing-score";

const NOW = new Date("2026-09-25T12:00:00.000Z");

function row(overrides: Partial<MentionReadRow> & Pick<MentionReadRow, "id" | "p">): MentionReadRow {
  return {
    title: overrides.title ?? "Zephyrwear opens a London flagship",
    url: overrides.url ?? "https://news.example/flagship",
    platform: overrides.platform ?? "gdelt",
    kind: overrides.kind ?? "mentions",
    publishedAt: overrides.publishedAt === undefined ? "2026-09-24T08:00:00.000Z" : overrides.publishedAt,
    observedAt: overrides.observedAt ?? "2026-09-25T08:00:00.000Z",
    entityState: overrides.entityState ?? "on",
    id: overrides.id,
    p: overrides.p,
  };
}

function item(mention: MentionRowModel): AlertFeedItem {
  return { kind: "mention", id: mention.id, at: mention.observedAt, mention };
}

const BANNED = /probability|confidence|mention_matters|mention_is_about_brand|\b0\.\d{2,}\b/i;

describe("mentions feed", () => {
  it("reads the mention view and keeps off brands out of the query", () => {
    expect(MENTION_FEED_SQL).toContain("FROM mention");
    expect(MENTION_FEED_SQL).toContain("e.state = 'on'");
    expect(MENTION_FEED_SQL).not.toMatch(/CREATE TABLE|mention_matters/);
    expect(mentionFeedBinds("ws-1", D6_QUESTION_ID)).toEqual(["ws-1", "mention_matters"]);
  });

  it("puts p >= 0.9 in the feed, the middle band on possibly, and p <= 0.1 behind show all", () => {
    expect(mentionTreatment(0.9)).toBe("shown");
    expect(mentionTreatment(1)).toBe("shown");
    expect(mentionTreatment(0.5)).toBe("possibly");
    expect(mentionTreatment(0.11)).toBe("possibly");
    expect(mentionTreatment(0.1)).toBe("held");
    expect(mentionTreatment(0)).toBe("held");
  });

  it("says found today when published_at is null and a relative time otherwise", () => {
    expect(mentionWhen(null, NOW)).toBe(FOUND_TODAY);
    expect(mentionWhen("2026-09-23T00:00:00.000Z", NOW)).toBe("2 days ago");
    expect(FOUND_TODAY).not.toBe("today");
  });

  it("drops off brands, unjudged rows and empty titles, and never keeps the probability on the row", () => {
    const mentions = mentionsFromRows(
      [
        row({ id: "high", p: 0.95, platform: "gdelt" }),
        row({ id: "mid", p: 0.42, platform: "hn", publishedAt: null, title: "Zephyrwear shows up in a roundup" }),
        row({ id: "low", p: 0.05, platform: "medium", title: "Zephyrwear ticker line" }),
        row({ id: "off", p: 0.99, entityState: "off", title: "Paused brand should stay hidden" }),
        row({ id: "dismissed", p: 0.99, entityState: "dismissed", title: "Dismissed brand should stay hidden" }),
        row({ id: "unjudged", p: null, title: "No verdict yet" }),
        row({ id: "blank", p: 0.95, title: "  " }),
      ],
      NOW,
    );
    expect(mentions.map((mention) => mention.id)).toEqual(["high", "mid", "low"]);
    expect(mentions.map((mention) => mention.treatment)).toEqual(["shown", "possibly", "held"]);
    expect(mentions.map((mention) => mention.sourceName)).toEqual([
      "News mentions",
      "Hacker News mentions",
      "Medium mentions",
    ]);
    expect(mentions[1]?.when).toBe(FOUND_TODAY);
    expect(mentions.every((mention) => !("p" in mention))).toBe(true);
    expect(visibleMentions(mentions, false).map((mention) => mention.id)).toEqual(["high", "mid"]);
    expect(visibleMentions(mentions, true).map((mention) => mention.id)).toEqual(["high", "mid", "low"]);
  });

  it("does not also show the mention alert row the sweep wrote for a high score", () => {
    expect(
      withoutMentionAlerts([
        { kind: "mention", id: "mention-sig" },
        { kind: "ad", id: "ad-sig" },
      ]).map((signal) => signal.id),
    ).toEqual(["ad-sig"]);
  });

  it("renders the three treatments with a source pill and a time, and no machinery in the open row", () => {
    const mentions = mentionsFromRows(
      [
        row({ id: "high", p: 0.95 }),
        row({ id: "mid", p: 0.42, platform: "hn", publishedAt: null, title: "Zephyrwear shows up in a roundup" }),
        row({ id: "low", p: 0.04, platform: "medium", title: "Zephyrwear ticker line" }),
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
    expect(html).toContain(FOUND_TODAY);
    expect(html).toContain(POSSIBLY_LINE);
    expect(html).toContain("Why we flagged this");
    expect(html.match(/data-treatment="possibly"/g)).toHaveLength(1);
    expect(html).not.toMatch(BANNED);
    for (const mention of mentions) {
      expect(mentionWhy(mention.treatment, mention.sourceName)).not.toMatch(BANNED);
    }
  });

  it("keeps the low band out of the default feed until show all", () => {
    const mentions = mentionsFromRows(
      [
        row({ id: "high", p: 0.95 }),
        row({ id: "low", p: 0.04, title: "Zephyrwear ticker line" }),
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
