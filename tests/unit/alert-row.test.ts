import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AlertFeedRow, type AlertFeedItem } from "../../app/components/alert-row";
import { buttonVariants } from "../../app/components/ui/button";
import type { BriefPayload } from "../../app/lib/brief-payload";

const ROW_NAME_TITLE = '<h3 class="font-display text-row-name font-bold [overflow-wrap:anywhere]">';
const META_WHEN = 'class="mt-2 block font-mono text-meta text-ink-soft uppercase"';
const READ_BRIEF_CLASS = buttonVariants({ variant: "tertiary", className: "cursor-pointer" });

const HIRING_ITEM: AlertFeedItem = {
  kind: "hiring",
  id: "sig_hiring_1",
  at: "2026-09-25T09:00:00Z",
  hiring: {
    id: "sig_hiring_1",
    title: "Senior Backend Engineer",
    brand: "Zephyrwear",
    detail: "Berlin · Platform",
    url: "https://boards.greenhouse.io/zephyr/jobs/1",
    at: "2026-09-25T09:00:00Z",
    when: "yesterday",
  },
};

const NOTE_ITEM: AlertFeedItem = {
  kind: "note",
  id: "alert_note_1",
  at: "2026-09-24T08:00:00Z",
  note: {
    id: "alert_note_1",
    title: "Removal request handled",
    created_at: "2026-09-24T08:00:00Z",
    when: "today",
  },
};

const FAILURE_ITEM: AlertFeedItem = {
  kind: "failure",
  id: "alert_failure_1",
  at: "2026-09-22T08:00:00Z",
  failure: {
    id: "alert_failure_1",
    title: "We stopped trying to send your brief",
    body: "The brief did not go out. We will not try again.",
    created_at: "2026-09-22T08:00:00Z",
    when: "4 days ago",
    digest_id: null,
    brief: null,
  },
};

const LINKED_FAILURE_ITEM: AlertFeedItem = {
  kind: "failure",
  id: "alert_failure_1",
  at: "2026-09-22T08:00:00Z",
  failure: {
    id: "alert_failure_1",
    title: "We stopped trying to send your brief",
    body: "The brief did not go out. We will not try again.",
    created_at: "2026-09-22T08:00:00Z",
    when: "4 days ago",
    digest_id: "dg_1",
    brief: null,
  },
};

const BRIEF: BriefPayload = {
  workspace_id: "ws_1",
  timezone: "UTC",
  period_start: "2026-09-14",
  period_end: "2026-09-21",
  headline_rank: 1,
  headline_total: 3,
  headline_movement: 0,
  headline_is_new: false,
  why_line: "Nothing crossed the bar this week.",
  is_quiet_week: true,
  is_unjudged: false,
  read_this_first: [],
  brands: [],
  own_site: { status: "ok", incidents: [] },
  checked: {
    mention_count: 61,
    site_change_count: 2,
    new_ad_count: 0,
    source_keys: [],
    degraded_source_keys: [],
    degraded_sources: [],
  },
  next_brief_at: null,
};

const BRIEF_FAILURE_ITEM: AlertFeedItem = {
  kind: "failure",
  id: "alert_failure_2",
  at: "2026-09-22T08:00:00Z",
  failure: {
    id: "alert_failure_2",
    title: "We stopped trying to send your brief",
    body: "The brief did not go out. We will not try again.",
    created_at: "2026-09-22T08:00:00Z",
    when: "4 days ago",
    digest_id: null,
    brief: BRIEF,
  },
};

const SIGNAL_ITEM: AlertFeedItem = {
  kind: "signal",
  id: "mention-sig-1",
  at: "2026-09-24T01:00:00Z",
  signal: {
    id: "mention-sig-1",
    title: "Alphalete: Alphalete opens a London flagship",
    body: "news.example.com",
    url: "https://news.example.com/alphalete-london",
    created_at: "2026-09-24T01:00:00Z",
    when: "today",
  },
};

const MENTION_ITEM: AlertFeedItem = {
  kind: "mention",
  id: "mention-1",
  at: "2026-09-24T01:00:00Z",
  mention: {
    id: "mention-1",
    title: "Zephyrwear: A launch post",
    url: "https://news.example.com/zephyr",
    sourceName: "news.example.com",
    publishedAt: "2026-09-24T01:00:00Z",
    observedAt: "2026-09-24T01:00:00Z",
    treatment: "shown",
    when: "today",
    why: null,
    whyFlagged: null,
    alsoCount: 0,
  },
};

const CONTENT_ITEM: AlertFeedItem = {
  kind: "content",
  id: "content-1",
  at: "2026-09-24T01:00:00Z",
  content: {
    id: "content-1",
    title: "Zephyrwear: A new blog post",
    brand: "Zephyrwear",
    excerpt: null,
    url: "https://brand.example.com/post",
    at: "2026-09-24T01:00:00Z",
    when: "today",
  },
};

function render(item: AlertFeedItem): string {
  return renderToStaticMarkup(createElement(AlertFeedRow, { item, eager: false }));
}

describe("an alert feed row", () => {
  it("renders a takedown note title in the house row-name type and the day in the house meta type", () => {
    const html = render(NOTE_ITEM);
    expect(html).toContain('data-testid="takedown-note"');
    expect(html).toContain(`${ROW_NAME_TITLE}Removal request handled</h3>`);
    expect(html).toContain(META_WHEN);
    expect(html).toContain("today");
    expect(html).toContain('dateTime="2026-09-24T08:00:00Z"');
  });

  it("renders a delivery failure title in the house row-name type and omits a missing brief", () => {
    const html = render(FAILURE_ITEM);
    expect(html).toContain('data-testid="delivery-failure"');
    expect(html).toContain(`${ROW_NAME_TITLE}We stopped trying to send your brief</h3>`);
    expect(html).toContain("The brief did not go out. We will not try again.");
    expect(html).toContain("4 days ago");
    expect(html).not.toContain("Read the brief");
    expect(html).not.toContain("/app/brief/");
  });

  it("keeps Read the brief a no-JS summary wearing the tertiary button look and a 44px target", () => {
    const html = render(BRIEF_FAILURE_ITEM);
    expect(html).toContain(`<summary class="${READ_BRIEF_CLASS}">Read the brief</summary>`);
    expect(html).toContain("<details");
    expect(html).not.toContain("<button");
    expect(html).toContain("min-h-11");
  });

  it("never leaves a row title on the old text-lg font-semibold type", () => {
    const html = `${render(NOTE_ITEM)}${render(FAILURE_ITEM)}${render(SIGNAL_ITEM)}${render(BRIEF_FAILURE_ITEM)}`;
    expect(html).not.toContain("text-lg font-semibold");
  });

  it("links an undeliverable brief to its own page", () => {
    const html = render(LINKED_FAILURE_ITEM);
    expect(html).toContain('href="/app/brief/dg_1"');
    expect(html).toContain("Open it with your past briefs");
  });

  it("links a news row's headline out to the article in a new tab, with the publisher under it", () => {
    const html = render(SIGNAL_ITEM);
    expect(html).toContain('data-testid="signal-alert"');
    expect(html).toContain('href="https://news.example.com/alphalete-london"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("news.example.com</p>");
  });

  it("never renders a question id, a probability or a confidence label", () => {
    const html = `${render(NOTE_ITEM)}${render(FAILURE_ITEM)}${render(SIGNAL_ITEM)}`;
    expect(html).not.toMatch(/probability|confidence|question/i);
  });

  it("keeps the content, hiring and mention headline links on a 44px tap target", () => {
    const link = (item: AlertFeedItem): string => render(item).match(/<a\b[^>]*>/)?.[0] ?? "";
    for (const item of [CONTENT_ITEM, HIRING_ITEM, MENTION_ITEM]) {
      expect(link(item)).toContain("min-h-11");
      expect(link(item)).toContain("inline-flex");
      expect(link(item)).toContain("items-center");
    }
  });
});

describe("hiring row", () => {
  it("links the role out safely, names the brand with its place and team, and shows the age", () => {
    const html = renderToStaticMarkup(createElement(AlertFeedRow, { item: HIRING_ITEM, eager: false }));
    expect(html).toContain('data-testid="hiring-row"');
    expect(html).toContain('href="https://boards.greenhouse.io/zephyr/jobs/1"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain("Senior Backend Engineer");
    expect(html).toContain("Zephyrwear is hiring · Berlin · Platform");
    expect(html).toContain("yesterday");
  });

  it("leaves out the place and team when the posting has none", () => {
    const item: AlertFeedItem =
      HIRING_ITEM.kind === "hiring" ? { ...HIRING_ITEM, hiring: { ...HIRING_ITEM.hiring, detail: null } } : HIRING_ITEM;
    const html = renderToStaticMarkup(createElement(AlertFeedRow, { item, eager: false }));
    expect(html).toContain("Zephyrwear is hiring<");
  });
});

describe("new-tab link a11y", () => {
  const NEW_TAB_TEXT = " (opens in a new tab)";
  const TITLE = "Spring pricing update";

  const signalItem = {
    ...SIGNAL_ITEM,
    signal: { ...SIGNAL_ITEM.signal, title: TITLE },
  };
  const mentionItem = {
    ...MENTION_ITEM,
    mention: { ...MENTION_ITEM.mention, title: TITLE },
  };
  const hiringItem = {
    ...HIRING_ITEM,
    hiring: { ...HIRING_ITEM.hiring, title: TITLE },
  };
  const contentItem = {
    ...CONTENT_ITEM,
    content: { ...CONTENT_ITEM.content, title: TITLE },
  };

  function linkTextContent(html: string): string {
    const match = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/);
    const inner = match?.[0].slice(match[0].indexOf(">") + 1, match[0].lastIndexOf("</a>")) ?? "";
    return inner.replace(/<[^>]*>/g, "");
  }

  function renderItem(item: AlertFeedItem): string {
    return renderToStaticMarkup(createElement(AlertFeedRow, { item, eager: false }));
  }

  for (const [kind, item] of [
    ["signal", signalItem],
    ["mention", mentionItem],
    ["hiring", hiringItem],
    ["content", contentItem],
  ] as const) {
    it(`renders the ${kind} link with sr-only new-tab text`, () => {
      const html = renderItem(item);
      expect(linkTextContent(html)).toBe(`${TITLE}${NEW_TAB_TEXT}`);
      expect(html).toContain(`<span class="sr-only">${NEW_TAB_TEXT}</span>`);
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer nofollow"');
    });
  }
});
