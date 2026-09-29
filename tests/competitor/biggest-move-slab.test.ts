import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { BiggestMove, type BiggestMoveProps } from "../../app/components/biggest-move";
import type { SiteChangeItemData } from "../../app/components/site-change-item";
import type { BiggestMoveView } from "../../app/lib/biggest-move";

const change: SiteChangeItemData = {
  id: "sig-1",
  entityId: "ent-kindred",
  isSelf: false,
  headline: "Kindred changed its homepage",
  page: "homepage",
  url: "https://kindred.example/",
  observedAt: "2026-09-24T02:10:00.000Z",
  capturedAt: "2026-09-24 02:09 UTC",
  wordsChanged: 5,
  sentence: "3 words added, 2 removed.",
  mark: { removed: "Plans from $10.", added: "Plans from $12." },
  before: { src: "/app/changes/sig-1/before", capturedAt: "2026-09-23 02:09 UTC" },
  after: { src: "/app/changes/sig-1/after", capturedAt: "2026-09-24 02:09 UTC" },
  whyFlagged: null,
  when: "today",
};

const QUIET =
  "Nothing scored for this brand in the last 7 days. We checked Website and Ad library, last at 2026-09-24 02:10 UTC.";

const READ =
  "Mentions that matter: 3 × 0.9 = 2.7 points, the most of anything this brand did this week.";

function move(overrides: Partial<BiggestMoveView> = {}): BiggestMoveView {
  return {
    id: "sig-9",
    kind: "mention",
    source: "Mention · web",
    title: "Kindred is hiring a growth lead",
    url: "https://example.com/post/1",
    when: "2 days ago",
    read: READ,
    weight: 3,
    multiplier: 0.9,
    points: 2.7,
    ...overrides,
  };
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, element));
}

function slab(props: BiggestMoveProps): string {
  return render(createElement(BiggestMove, props));
}

describe("the biggest-move slab", () => {
  it("draws the quiet-week sentence when nothing scored", () => {
    const html = slab({ move: null, change: null, quiet: QUIET });
    expect(html).toContain(QUIET);
    expect(html).not.toContain('data-slot="biggest-move-read"');
  });

  it("draws a change move as the full mark with its capture pair", () => {
    const html = slab({
      move: move({ id: "sig-1", kind: "change", title: change.headline }),
      change,
      quiet: QUIET,
    });
    expect(html).toContain("<s");
    expect(html).toContain("Plans from $10.");
    expect(html).toContain("<ins");
    expect(html).toContain("Plans from $12.");
    expect(html).toContain('aria-label="Open before and after: Kindred changed its homepage"');
    expect(html).toContain('data-size="lg"');
    expect(html).toContain(READ);
  });

  it("draws a mention move as title, source line, link and read", () => {
    const html = slab({ move: move(), change: null, quiet: QUIET });
    expect(html).toContain("Kindred is hiring a growth lead");
    expect(html).toContain("Mention · web");
    expect(html).toContain("2 days ago");
    expect(html).toContain("Open the source");
    expect(html).toContain('href="https://example.com/post/1"');
    expect(html).toContain(READ);
    expect(html).not.toContain("<ins");
  });

  it("drops the source link when the move has no url", () => {
    const html = slab({ move: move({ url: null }), change: null, quiet: QUIET });
    expect(html).not.toContain("Open the source");
    expect(html).toContain(READ);
  });
});
