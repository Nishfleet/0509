import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AlertFeed } from "../../app/components/alert-feed";
import type { AlertFeedItem } from "../../app/components/alert-row";
import { mentionsFromRows, type MentionReadRow, type MentionRowModel } from "../../app/lib/mention-feed";

const NOW = new Date("2026-09-25T12:00:00.000Z");

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

function feed(mentions: MentionRowModel[]): string {
  return renderToStaticMarkup(createElement(AlertFeed, { groups: [{ group: "NEW", items: mentions.map(item) }] }));
}

describe("alert feed reveal button", () => {
  const mentions = mentionsFromRows(
    [
      row({ id: "held", p: 0.1, title: "Zephyrwear ticker line" }),
      row({ id: "shown", p: 0.9, title: "Zephyrwear opens a London flagship" }),
    ],
    NOW,
  );
  const held = mentions.filter((mention) => mention.treatment === "held");
  if (held.length === 0) throw new Error("expected at least one held mention");

  it("keeps the reveal button mounted with aria-expanded=false and the Show all label while collapsed", () => {
    const html = feed(mentions);
    // Assert on the reveal button itself, not any other aria-expanded on the
    // page (the "Why we flagged" dialog trigger also carries aria-expanded).
    expect(html).toMatch(
      /<button[^>]*data-testid="mentions-show-all"[^>]*aria-expanded="false"[^>]*>\s*Show all, including \d+ we think (?:do|does) not matter\s*<\/button>/,
    );
    expect(html).not.toMatch(
      /<button[^>]*data-testid="mentions-show-all"[^>]*>\s*Hide the \d+ we think (?:do|does) not matter/,
    );
  });

  it("renders no reveal button when nothing is held", () => {
    const html = feed(mentionsFromRows([row({ id: "shown", p: 0.9 })], NOW));
    expect(html).not.toContain('data-testid="mentions-show-all"');
    expect(html).not.toMatch(/Show all/);
  });

  it("uses the singular phrase when exactly one item is held", () => {
    const html = feed(mentionsFromRows([row({ id: "held-one", p: 0.1 }), row({ id: "shown-one", p: 0.9 })], NOW));
    expect(html).toMatch(
      /<button[^>]*data-testid="mentions-show-all"[^>]*aria-expanded="false"[^>]*>\s*Show all, including 1 we think does not matter\s*<\/button>/,
    );
  });

  it("keeps the plural phrase when more than one item is held", () => {
    const html = feed(
      mentionsFromRows(
        [row({ id: "held-a", p: 0.05 }), row({ id: "held-b", p: 0.05 }), row({ id: "shown-many", p: 0.9 })],
        NOW,
      ),
    );
    expect(html).toMatch(
      /<button[^>]*data-testid="mentions-show-all"[^>]*aria-expanded="false"[^>]*>\s*Show all, including 2 we think do not matter\s*<\/button>/,
    );
  });
});
