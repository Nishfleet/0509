import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AlertChipEmpty } from "../app/components/alert-chip-empty";
import type { AlertFeedItem } from "../app/components/alert-row";
import { ALERT_CHIPS, type AlertChipKey } from "../app/lib/alert-chips";
import { groupByDay } from "../app/lib/alert-day";

const NOW = new Date("2026-10-02T08:00:00.000Z");

const NOTE: AlertFeedItem = {
  kind: "note",
  id: "note-1",
  at: "2026-10-02T07:00:00.000Z",
  note: { id: "note-1", title: "A takedown request", created_at: "2026-10-02T07:00:00.000Z", when: "today" },
};

type Counts = Record<AlertChipKey, number>;

function emptyCounts(): Counts {
  return Object.fromEntries(ALERT_CHIPS.map((chip) => [chip.key, 0])) as Counts;
}

function render(chip: AlertChipKey, counts: Counts = emptyCounts(), groups: readonly unknown[] = []): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(AlertChipEmpty, { chip, counts, groups })),
  );
}

describe("AlertChipEmpty", () => {
  it("renders nothing for All", () => {
    expect(render("all")).toBe("");
  });

  it("renders nothing when the workspace holds rows of any kind", () => {
    expect(render("hiring", emptyCounts(), groupByDay([NOTE], NOW, "UTC"))).toBe("");
  });

  it("renders nothing when the named chip has rows of its own", () => {
    expect(render("hiring", { ...emptyCounts(), hiring: 3 })).toBe("");
  });

  it("still renders the empty state when a different chip has rows", () => {
    expect(render("hiring", { ...emptyCounts(), ads: 4 })).toContain('data-testid="alert-chip-empty"');
  });

  it.each(ALERT_CHIPS.filter((chip) => chip.key !== "all"))(
    "names $key, lower case, and links back to All",
    ({ key, label }) => {
      const html = render(key);
      expect(html).toContain('data-testid="alert-chip-empty"');
      expect(html).toContain(`No ${label.toLowerCase()} alerts yet. Everything else is still under All.`);
      expect(html).toContain('href="/app/alerts"');
      expect(html).toContain("See everything");
    },
  );
});
