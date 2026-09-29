import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AlertFeed } from "../../app/components/alert-feed";
import type { AlertFeedItem } from "../../app/components/alert-row";
import { MentionRow } from "../../app/components/mention-row";
import {
  mentionsFromRows,
  POSSIBLY_LINE,
  UNREVIEWED_LINE,
  type MentionReadRow,
  type MentionRowModel,
} from "../../app/lib/mention-feed";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const BANNED = /confidence|probability|\d+(\.\d+)?%|\b0\.\d+\b/i;

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
  };
}

function item(mention: MentionRowModel): AlertFeedItem {
  return { kind: "mention", id: mention.id, at: mention.observedAt, mention };
}

describe("low-confidence alerts", () => {
  const mentions = mentionsFromRows(
    [
      row({ id: "mid", p: 0.5, title: "Zephyrwear shows up in a roundup" }),
      row({ id: "unjudged", p: null, title: "No verdict yet" }),
    ],
    NOW,
  );
  const [possibly, unreviewed] = mentions;
  if (possibly === undefined || unreviewed === undefined) throw new Error("expected both rows to survive");
  const possiblyHtml = renderToStaticMarkup(createElement(MentionRow, { mention: possibly }));
  const unreviewedHtml = renderToStaticMarkup(createElement(MentionRow, { mention: unreviewed }));

  it("keeps both rows on the bone ground, not the card", () => {
    expect(possibly.treatment).toBe("possibly");
    expect(unreviewed.treatment).toBe("unreviewed");
    expect(possiblyHtml).toContain("bg-bone");
    expect(unreviewedHtml).toContain("bg-bone");
    expect(possiblyHtml).not.toContain("bg-card");
    expect(unreviewedHtml).not.toContain("bg-card");
  });

  it("says what each treatment is without naming a score", () => {
    expect(possiblyHtml).toContain(POSSIBLY_LINE);
    expect(unreviewedHtml).toContain(UNREVIEWED_LINE);
    expect(unreviewedHtml).toMatch(/unreviewed/i);
    expect(possiblyHtml).toMatch(/<button[^>]*>Why we flagged this</);
    expect(unreviewedHtml).not.toMatch(/Why we flagged this/);
    expect(possiblyHtml).not.toMatch(BANNED);
    expect(unreviewedHtml).not.toMatch(BANNED);
  });

  it("shows both rows by default without Show all", () => {
    const html = renderToStaticMarkup(
      createElement(AlertFeed, { groups: [{ group: "NEW", items: mentions.map(item) }] }),
    );
    expect(html.match(/data-testid="mention-row"/g)).toHaveLength(2);
    expect(html).not.toContain("Show all");
  });
});
