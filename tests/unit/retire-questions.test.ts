import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import type { RetireQuestion } from "../../app/lib/data/entity.server";
import { RetireQuestions } from "../../app/components/retire-questions";

const quiet: RetireQuestion = {
  suggestionId: "sug-retire-quiet",
  entityId: "ws-acme",
  name: "Acme Corp",
  domain: "acme.example",
  reason: "Quiet for weeks now",
};

const shifted: RetireQuestion = {
  suggestionId: "sug-retire-shifted",
  entityId: "ws-north",
  name: "Northwind",
  domain: "north.example",
  reason: "Sells a different thing now",
};

// A data router renders a <Form>; MemoryRouter's absence of the actions/loaders
// context is why the render goes through createRoutesStub instead.
function render(questions: readonly RetireQuestion[]): string {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => createElement(RetireQuestions, { questions }),
    },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

describe("retire questions", () => {
  it("renders nothing when the weekly refresh is not asking about anyone", () => {
    expect(render([])).toBe("");
  });

  it("lists each question with its reason and both answers", () => {
    const html = render([quiet, shifted]);

    expect(html).toContain("Still competing?");
    expect(html).toContain("Acme Corp");
    expect(html).toContain("acme.example");
    expect(html).toContain("Quiet for weeks now");
    expect(html).toContain("Northwind");
    expect(html).toContain("north.example");
    expect(html).toContain("Sells a different thing now");
  });

  it("posts the suggestionId with the intent each button names", () => {
    const html = render([quiet, shifted]);

    // The Button primitive orders `value` ahead of `name` in the rendered
    // attributes, so the assertion matches the button shape (a <button> that
    // carries BOTH name="intent" and value="stop" or value="keep") rather than
    // a literal substring order.
    const stopButton = /<button[^>]*?(?:name="intent"[^>]*?value="stop"|value="stop"[^>]*?name="intent")[^>]*>/g;
    const keepButton = /<button[^>]*?(?:name="intent"[^>]*?value="keep"|value="keep"[^>]*?name="intent")[^>]*>/g;
    expect(html.match(stopButton)?.length).toBe(2);
    expect(html.match(keepButton)?.length).toBe(2);
    expect(html).toContain('name="suggestionId" value="sug-retire-quiet"');
    expect(html).toContain('name="suggestionId" value="sug-retire-shifted"');
  });

  it("names both answers for the brand they act on", () => {
    const html = render([quiet, shifted]);

    expect(html).toContain('aria-label="Stop tracking Acme Corp"');
    expect(html).toContain('aria-label="Keep tracking Acme Corp"');
    expect(html).toContain('aria-label="Stop tracking Northwind"');
    expect(html).toContain('aria-label="Keep tracking Northwind"');
  });

  it("shows no verdict code and no probability", () => {
    // Tailwind utility class names carry numeric fragments like `min-h-11`,
    // `gap-3`, `focus-visible:outline-2` and bracket literals — framework
    // noise, not user-visible copy. DESIGN.md §2.10 only forbids machinery
    // from reaching the customer, so assert on the visible text nodes, which
    // is what the rule is about.
    const html = render([quiet, shifted]);
    const visible = html.replace(/<[^>]+>/g, "");

    // The fixture reasons, ids and domains carry no digit, so any digit in
    // the visible text came from this component leaking a probability.
    expect(visible).not.toMatch(/\d/);
    for (const machinery of ["dormant", "pivoted", "shut_down", "still_competitor"]) {
      expect(visible).not.toContain(machinery);
    }
  });
});
