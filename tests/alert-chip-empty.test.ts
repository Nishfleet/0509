import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AlertChipEmpty } from "../app/components/alert-chip-empty";
import { ALERT_CHIPS, type AlertChipKey } from "../app/lib/alert-chips";

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
    const groups = [{ group: "TODAY", items: [{ id: "sig-1" }] }];
    expect(render("hiring", emptyCounts(), groups)).toBe("");
  });

  it("renders nothing when the named chip has rows of its own", () => {
    const counts = { ...emptyCounts(), hiring: 3 };
    expect(render("hiring", counts)).toBe("");
  });

  it("names each empty chip, lower case, and links back to All", () => {
    for (const { key, label } of ALERT_CHIPS) {
      if (key === "all") continue;
      const html = render(key);
      expect(html).toContain('data-testid="alert-chip-empty"');
      expect(html).toContain(`No ${label.toLowerCase()} alerts yet. Everything else is still under All.`);
      expect(html).toContain('href="/app/alerts"');
      expect(html).toContain("See everything");
    }
  });
});
