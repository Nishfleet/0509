import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { FirstBriefNote } from "../../app/components/first-brief-note";
import { FirstWeekSteps } from "../../app/components/first-week-steps";

function inRouter(element: ReturnType<typeof createElement>): string {
  const router = createMemoryRouter([{ path: "/", element }]);
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("FirstWeekSteps", () => {
  it("links each first-week action to the page that does it", () => {
    const html = inRouter(createElement(FirstWeekSteps));
    expect(html).toContain('href="/app/competitors"');
    expect(html).toContain('href="/app/settings"');
    expect(html).toContain('href="/app/settings/agents"');
    expect(html).toContain("While you wait");
  });
});

describe("FirstBriefNote", () => {
  it("names the real arrival time and says what the brief holds", () => {
    const html = renderToStaticMarkup(
      createElement(FirstBriefNote, { arrivesAt: "Monday 5 October 2026, 08:00 Europe/Berlin" }),
    );
    expect(html).toContain("Your first brief arrives Monday 5 October 2026, 08:00 Europe/Berlin.");
    expect(html).toContain("The three things worth knowing.");
  });

  it("never says soon when no time is known", () => {
    const html = renderToStaticMarkup(createElement(FirstBriefNote, { arrivesAt: null }));
    expect(html).toContain("first full week of tracking");
  });
});
