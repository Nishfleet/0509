import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import type { AlertFeedItem } from "../../app/components/alert-row";
import { countAlertChips, type AlertChipKey, type AlertItemKind } from "../../app/lib/alert-chips";
import Page from "../../app/routes/app.alerts";

// Nishfleet/0509#6617. A bookmarked or shared /app/alerts?kind=<chip> used to
// render the heading and the chips and then nothing when that one chip held no
// rows and the workspace held other alerts. DESIGN.md 7: every empty surface
// says what will fill it. The route decides between the all-zero sentence it
// already carried and this per-chip sentence, and never both.

const NOTE: AlertFeedItem = {
  kind: "note",
  id: "note-1",
  at: "2026-10-02T08:00:00.000Z",
  note: { id: "note-1", title: "A takedown request", created_at: "2026-10-02T08:00:00.000Z", when: "today" },
};

const NOTE_GROUP = [{ group: "TODAY", items: [NOTE] }];

function counts(kinds: AlertItemKind[], incidents = 0): Record<AlertChipKey, number> {
  return countAlertChips(kinds, incidents);
}

function render(chip: AlertChipKey, chipCounts: Record<AlertChipKey, number>, groups: unknown[]): string {
  const Stub = createRoutesStub([{ id: "routes/app.alerts", path: "/app/alerts", Component: Page }]);
  return renderToStaticMarkup(
    createElement(Stub, {
      initialEntries: [`/app/alerts?kind=${chip}`],
      hydrationData: {
        loaderData: {
          "routes/app.alerts": {
            failedBrief: null,
            openIncident: null,
            sources: [],
            incidents: [],
            chip,
            chipCounts,
            hiringCapped: false,
            groups,
            offLine: null,
            now: Date.UTC(2026, 9, 2, 8, 0, 0),
          },
        },
      },
    }),
  );
}

function linkBackToAll(html: string): string {
  return html.match(/<a\b[^>]*href="\/app\/alerts"[^>]*>/)?.[0] ?? "";
}

describe("an Alerts chip with no rows of its own (0509#6617)", () => {
  it("says the chip is empty and links back to All when other alerts exist", () => {
    const html = render("hiring", counts(["note", "change"]), []);

    expect(html).toContain("No hiring alerts yet. Everything else is still under All.");
    expect(linkBackToAll(html)).toContain("min-h-11");
  });

  it("takes the label from ALERT_CHIPS, lower case", () => {
    const html = render("site-changes", counts(["note"]), []);

    expect(html).toContain("No site changes alerts yet. Everything else is still under All.");
  });

  it("renders neither the sentence nor the link for All with rows", () => {
    const html = render("all", counts(["note"]), NOTE_GROUP);

    expect(html).not.toContain("alerts yet. Everything else is still under All.");
    expect(linkBackToAll(html)).toBe("");
  });

  it("renders neither when the named chip has its own rows", () => {
    const html = render("hiring", counts(["hiring"]), [{ group: "TODAY", items: [NOTE] }]);

    expect(html).not.toContain("alerts yet. Everything else is still under All.");
    expect(linkBackToAll(html)).toBe("");
  });

  it("keeps the older all-zero sentence and never renders both", () => {
    const html = render("hiring", counts([]), []);

    expect(html).toContain("Nothing yet. When a competitor changes its website");
    expect(html).not.toContain("No hiring alerts yet.");
  });
});
