import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { IncidentBlock, type IncidentBlockProps } from "../../app/components/incident-block";

function props(): IncidentBlockProps {
  return {
    alertId: "alt_42",
    title: "Homepage is 500ing",
    kind: "500 Internal Server Error",
    url: "https://example.com/",
    openedLabel: "five minutes ago",
    recheckAt: "2026-09-25T11:00:00.000Z",
    recheckLabel: "11:00 UTC",
  };
}

function render(overrides: Partial<IncidentBlockProps> = {}): string {
  return renderToStaticMarkup(createElement(IncidentBlock, { ...props(), ...overrides }));
}

describe("the incident block", () => {
  it("renders the eyebrow, the title, the evidence, the re-check time and the two actions", () => {
    const html = render();
    expect(html).toContain("OPEN INCIDENT");
    expect(html).toContain("var(--color-red)");
    expect(html).toContain("Homepage is 500ing");
    expect(html).toContain("500 Internal Server Error");
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain("Open your site");
    expect(html).toContain('name="intent"');
    expect(html).toContain('value="acknowledge"');
    expect(html).toContain("alt_42");
    expect(html).toContain("I meant to do this");
    expect(html).toContain("2026-09-25T11:00:00.000Z");
    expect(html).toContain("Why we flagged this");
  });

  it("uses a plain form so it renders without a router", () => {
    const html = render();
    expect(html).toContain("<form");
    expect(html).not.toContain("react-router");
  });

  it("does not leak probability, a question id or Jev wording", () => {
    const html = render();
    expect(html).not.toContain("%");
    expect(html).not.toContain("p=");
    expect(html).not.toContain("question");
  });
});
