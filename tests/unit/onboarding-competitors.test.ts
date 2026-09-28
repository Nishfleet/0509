import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { AddCompetitor, CompetitorMaybes } from "../../app/components/competitor-maybes";
import { Button } from "../../app/components/ui/button";

// Tailwind v4 spacing: --spacing is .25rem (build/client/assets/app-*.css), so
// min-h-11 = calc(var(--spacing) * 11) = 2.75rem = 44px and min-h-12 = 48px.
const SPACING_PX = 4;
const TAP_TARGET_PX = 44;

const MAYBES = [
  { suggestionId: "s-1", name: "Northwind", domain: "northwind.example", reason: "Named alongside you by 3 publishers" },
];

// A data router renders a <Form>; MemoryRouter's absence of the actions/loaders
// context is why the render goes through createRoutesStub instead.
function renderInRouter(element: ReactElement): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

/** Every class attribute on a rendered <button>, in document order. */
function buttonClasses(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*\bclass="([^"]*)"/g)].map((match) => match[1]);
}

function minHeightPx(classNames: string): number {
  const step = classNames.match(/\bmin-h-(\d+)\b/);
  return step ? Number(step[1]) * SPACING_PX : 0;
}

const SCREEN = createElement(
  "div",
  null,
  createElement(
    "form",
    { method: "post" },
    createElement("input", { type: "hidden", name: "intent", value: "start" }),
    createElement(Button, { type: "submit", size: "lg" }, "Start watching"),
  ),
  createElement(CompetitorMaybes, { maybes: MAYBES }),
  createElement(AddCompetitor, { message: null }),
);

describe("the /onboarding/competitors screen tap targets", () => {
  it("renders every control the screen shows as a 44px-or-taller target", () => {
    const classes = buttonClasses(renderInRouter(SCREEN));

    // Start watching, Watch, Dismiss, Add.
    expect(classes).toHaveLength(4);
    for (const cls of classes) {
      expect(minHeightPx(cls), `button class "${cls}" must be at least ${TAP_TARGET_PX}px`).toBeGreaterThanOrEqual(
        TAP_TARGET_PX,
      );
    }
  });
});
