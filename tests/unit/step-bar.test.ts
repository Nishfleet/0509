import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ONBOARDING_STEPS, StepBar } from "../../app/components/step-bar";

const LABELS = ["1 your site", "2 your card", "3 your competitors"] as const;

function markup(current: 1 | 2 | 3): string {
  return renderToStaticMarkup(createElement(StepBar, { current }));
}

describe("StepBar", () => {
  it("exports the three onboarding labels in order", () => {
    expect(ONBOARDING_STEPS).toEqual(["your site", "your card", "your competitors"]);
  });

  it.each([1, 2, 3] as const)("marks only step %s as the current step", (current) => {
    const html = markup(current);
    const currentMatches = html.match(/aria-current="step"/g) ?? [];
    expect(currentMatches).toHaveLength(1);

    for (const label of LABELS) {
      expect(html).toContain(label);
    }

    const items = [...html.matchAll(/<li\b([^>]*)>([^<]*)<\/li>/g)];
    expect(items).toHaveLength(3);
    const marked = items.filter(([, attrs]) => attrs.includes('aria-current="step"'));
    expect(marked).toHaveLength(1);
    expect(marked[0]?.[2]).toBe(LABELS[current - 1]);
    expect(marked[0]?.[1]).toContain("bg-green");

    const others = items.filter(([, attrs]) => !attrs.includes("aria-current"));
    expect(others).toHaveLength(2);
    for (const [, attrs, text] of others) {
      expect(attrs).not.toContain("bg-green");
      expect(text).not.toBe(LABELS[current - 1]);
    }

    expect(html).toContain('aria-label="Onboarding progress"');
    expect(html).not.toMatch(/<a[\s>]/);
  });
});
