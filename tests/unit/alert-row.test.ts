import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AlertFeedRow, type AlertFeedItem } from "../../app/components/alert-row";
import { buttonVariants } from "../../app/components/ui/button";
import type { BriefPayload } from "../../app/lib/brief-payload";

const ROW_NAME_TITLE = '<h3 class="font-display text-row-name font-bold [overflow-wrap:anywhere]">';
const META_WHEN = 'class="text-ink-soft mt-2 block font-mono text-meta uppercase"';
const READ_BRIEF_CLASS = buttonVariants({ variant: "tertiary", className: "cursor-pointer" });

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
    expect(html).toContain(
      `${ROW_NAME_TITLE}We stopped trying to send your brief</h3>`,
    );
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
});
