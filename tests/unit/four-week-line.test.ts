import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FourWeekLine } from "../../app/components/four-week-line";
import type { FourWeekChart } from "../../app/lib/home-standing";

function chart(overrides: Partial<FourWeekChart> = {}): FourWeekChart {
  return {
    weeks: ["14 SEP", "21 SEP"],
    lines: [
      { entityId: "ent_self", label: "YOU", self: true, paused: false, ranks: [1, 1] },
      { entityId: "ent_kindred", label: "Kindred", self: false, paused: true, ranks: [2, null] },
    ],
    ...overrides,
  };
}

describe("the four-week line", () => {
  it("renders the week labels and every line label during SSR, and no canvas", () => {
    const html = renderToStaticMarkup(createElement(FourWeekLine, { chart: chart() }));
    expect(html).toContain("14 SEP");
    expect(html).toContain("21 SEP");
    expect(html).toContain("Four-week ranks");
    expect(html).toContain("YOU");
    expect(html).toContain("Kindred");
    expect(html).toContain("paused");
    expect(html).toContain(">1<");
    expect(html).toContain(">2<");
    expect(html).toContain(">none<");
    expect(html).not.toContain("<canvas");
  });

  it("shows first week under the labels when only one week is frozen", () => {
    const html = renderToStaticMarkup(
      createElement(FourWeekLine, {
        chart: chart({ weeks: ["21 SEP"], lines: [{ entityId: "ent_self", label: "YOU", self: true, paused: false, ranks: [1] }] }),
      }),
    );
    expect(html).toContain("first week");
    expect(html).not.toContain("<canvas");
  });
});
