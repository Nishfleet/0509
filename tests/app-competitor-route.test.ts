import { describe, expect, it } from "vitest";

import * as competitorRoute from "~/routes/app.c.$id";
import * as boardRoute from "~/routes/app.watchlists";

/**
 * `/app/c/:id` — the competitor drill-in (route diet phase 1, #2213).
 *
 * Phase 1 gives the competitor screen its own URL without rewriting its data
 * path: the route reuses the board's loader and screen, so the evidence,
 * the seam's source-status sections, the pinned items and every share/export
 * intent stay on exactly one implementation. These assertions pin that
 * reuse, plus the one behaviour the new URL adds — an id that resolves to no
 * competitor is a 404, never a silent fall back to the board.
 */
describe("competitor drill-in route", () => {
  it("serves the board's own detail screen and action, not a copy", () => {
    expect(competitorRoute.default).toBe(boardRoute.default);
    expect(competitorRoute.action).toBe(boardRoute.action);
    expect(competitorRoute.ErrorBoundary).toBe(boardRoute.ErrorBoundary);
  });

  it("names itself as the competitor screen", () => {
    const meta = competitorRoute.meta as unknown as () => { title: string }[];
    expect(meta()[0]?.title).toBe("Competitor | Five to Nine");
  });

  it("404s when the path carries no competitor id", async () => {
    await expect(
      competitorRoute.loader({
        request: new Request("https://five-to-nine.test/app/c/"),
        params: {},
      } as never),
    ).rejects.toMatchObject({ status: 404 });
  });
});
