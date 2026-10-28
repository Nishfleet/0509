import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { CapRefusal } from "../../app/components/cap-refusal";
import { CompetitorCount } from "../../app/components/competitor-count";

const draw = (full: boolean) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(CompetitorCount, { line: "Watching 5 of 5 competitors. Your plan is full.", full }),
    ),
  );

describe("competitor count", () => {
  it("links to the plans page once the plan is full", () => {
    const html = draw(true);
    expect(html).toContain('data-slot="competitor-count"');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain("See plans");
  });

  it("is just the line while there is room", () => {
    expect(draw(false)).not.toContain("See plans");
  });

  it("renders See plans as a plain link, with no router around it", () => {
    const count = renderToStaticMarkup(
      createElement(CompetitorCount, { line: "Watching 5 of 5 competitors.", full: true }),
    );
    const refusal = renderToStaticMarkup(
      createElement(CapRefusal, { result: { message: "Your plan is full.", upgradePlanId: "starter" } }),
    );
    expect(count).toContain('href="/pricing"');
    expect(refusal).toContain('href="/pricing"');
  });
});
