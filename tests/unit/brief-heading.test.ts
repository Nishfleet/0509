import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: { DB: {} } }));

import { meta } from "../../app/routes/app.brief";

const WEEK = {
  id: "dig_1",
  week: "2026-09-14",
  line: "Sent 21 September",
};

const LOADER_DATA = {
  weeks: [WEEK],
  selected: { ...WEEK, status: "sent", payload: null },
};

let htmlPromise: Promise<string> | null = null;

function briefHtml(): Promise<string> {
  htmlPromise ??= import("../../app/routes/app.brief").then(({ default: Page }) =>
    renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: "/app/brief/dig_1" },
        createElement(Page, { loaderData: LOADER_DATA } as unknown as Parameters<typeof Page>[0]),
      ),
    ),
  );
  return htmlPromise;
}

describe("the brief page's Previous briefs heading", () => {
  it("wears the house row-name type, never the old text-lg font-semibold", async () => {
    expect(meta()).toEqual([{ title: "Your brief · Five to Nine" }]);
    const html = await briefHtml();
    expect(html).toContain('<h2 class="font-display text-row-name font-bold [overflow-wrap:anywhere]">');
    expect(html).toContain(">Previous briefs</h2>");
    expect(html).not.toContain("text-lg font-semibold");
  });
});
