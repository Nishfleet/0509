import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { ChangeFeedback } from "../../app/components/change-feedback";

const render = (feedback: "useful" | "not_useful" | null) => {
  const Stub = createRoutesStub([
    { path: "/", Component: () => createElement(ChangeFeedback, { signalId: "sig-1", feedback }) },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
};

describe("ChangeFeedback", () => {
  it("asks the question with a Yes and a No that post the signal id", () => {
    const html = render(null);
    expect(html).toContain('action="/app/changes/feedback"');
    expect(html).toContain('name="signalId" value="sig-1"');
    expect(html).toContain("Was this worth telling you?");
    expect(html).toContain('value="useful"');
    expect(html).toContain('value="not_useful"');
    expect(html).not.toContain('aria-pressed="true"');
  });

  it("names the Yes and No group by its question for a screen reader", () => {
    const html = render(null);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Was this worth telling you?"');
    expect(html).not.toContain(" id=");
  });

  it("thanks the customer and marks the chosen answer", () => {
    const html = render("not_useful");
    expect(html).toContain("Thanks, noted.");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });
});
