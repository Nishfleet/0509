import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AlertFeedRow, type AlertFeedItem } from "../../app/components/alert-row";

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
    brief: null,
  },
};

function render(item: AlertFeedItem): string {
  return renderToStaticMarkup(createElement(AlertFeedRow, { item, eager: false }));
}

describe("an alert feed row", () => {
  it("renders a takedown note title as a third-level heading", () => {
    const html = render(NOTE_ITEM);
    expect(html).toContain('data-testid="takedown-note"');
    expect(html).toContain('<h3 class="font-display text-lg font-semibold">Removal request handled</h3>');
    expect(html).toContain("today");
    expect(html).toContain('dateTime="2026-09-24T08:00:00Z"');
  });

  it("renders a delivery failure title as a third-level heading and omits a missing brief", () => {
    const html = render(FAILURE_ITEM);
    expect(html).toContain('data-testid="delivery-failure"');
    expect(html).toContain(
      '<h3 class="font-display text-lg font-semibold">We stopped trying to send your brief</h3>',
    );
    expect(html).toContain("The brief did not go out. We will not try again.");
    expect(html).toContain("4 days ago");
    expect(html).not.toContain("Read the brief");
  });

  it("never renders a question id, a probability or a confidence label", () => {
    const html = `${render(NOTE_ITEM)}${render(FAILURE_ITEM)}`;
    expect(html).not.toMatch(/probability|confidence|question/i);
  });
});
