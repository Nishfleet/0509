import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ONBOARDING_STEPS, StepBar } from "../../app/components/step-bar";

const LABELS = ["1 Your site", "2 Check details", "3 Competitors"] as const;

function markup(current: 1 | 2 | 3): string {
  return renderToStaticMarkup(createElement(StepBar, { current }));
}

// The done state is a nested <span>, so a step's inner HTML is captured whole
// and the tags are stripped to get the text a screen reader reads.
const ITEMS = /<li\b([^>]*)>([\s\S]*?)<\/li>/g;

function steps(html: string): { attrs: string; text: string }[] {
  return [...html.matchAll(ITEMS)].map(([, attrs, inner]) => ({
    attrs: attrs ?? "",
    text: (inner ?? "").replace(/<[^>]*>/g, ""),
  }));
}

describe("StepBar", () => {
  it("exports the three onboarding labels in order", () => {
    expect(ONBOARDING_STEPS).toEqual(["Your site", "Check details", "Competitors"]);
  });

  it.each([1, 2, 3] as const)("marks only step %s as the current step", (current) => {
    const html = markup(current);
    const currentMatches = html.match(/aria-current="step"/g) ?? [];
    expect(currentMatches).toHaveLength(1);

    for (const label of LABELS) {
      expect(html).toContain(label);
    }

    const items = steps(html);
    expect(items).toHaveLength(3);
    const marked = items.filter((step) => step.attrs.includes('aria-current="step"'));
    expect(marked).toHaveLength(1);
    expect(marked[0]?.text).toBe(LABELS[current - 1]);
    expect(marked[0]?.attrs).toContain("bg-green");

    const others = items.filter((step) => !step.attrs.includes("aria-current"));
    expect(others).toHaveLength(2);
    for (const step of others) {
      expect(step.attrs).not.toContain("bg-green");
      expect(step.text).not.toBe(LABELS[current - 1]);
    }

    expect(html).toContain('aria-label="Onboarding progress"');
  });

  it("announces every finished step as done for a screen reader", () => {
    // A finished step and an upcoming step differ only in text colour, so the
    // " (done)" span is the only thing a screen reader has to tell them apart.
    expect(steps(markup(3))[0]?.text).toBe("1 Your site (done)");
    expect(steps(markup(3))[1]?.text).toBe("2 Check details (done)");
    expect(steps(markup(3))[2]?.text).toBe("3 Competitors");
    expect(steps(markup(2))[0]?.text).toBe("1 Your site (done)");
    expect(steps(markup(2))[1]?.text).toBe("2 Check details");
    expect(steps(markup(2))[2]?.text).toBe("3 Competitors");
    expect(steps(markup(1))[0]?.text).toBe("1 Your site");
    expect(steps(markup(1))[1]?.text).toBe("2 Check details");
    expect(steps(markup(1))[2]?.text).toBe("3 Competitors");
  });

  it("marks only the finished steps done, once each", () => {
    const count = (current: 1 | 2 | 3) => (markup(current).match(/\(done\)/g) ?? []).length;
    expect(count(3)).toBe(2);
    expect(count(2)).toBe(1);
    expect(count(1)).toBe(0);
  });

  it("keeps the done marker out of sight but present", () => {
    const doneSpans = [...markup(3).matchAll(/<span class="sr-only"> \(done\)<\/span>/g)];
    expect(doneSpans).toHaveLength(2);
  });

  it("leaves the active and upcoming steps without a done marker", () => {
    const items = steps(markup(2));
    const marked = items.filter((step) => step.attrs.includes('aria-current="step"'));
    expect(marked[0]?.text).not.toContain("(done)");
    const upcoming = items[items.length - 1];
    expect(upcoming?.text).not.toContain("(done)");
  });
});
