import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OnboardingFrame } from "../../app/components/onboarding-frame";

function markup(props: { hideHeading?: boolean }): string {
  return renderToStaticMarkup(
    createElement(OnboardingFrame, { step: 2, heading: "H", ...props }, createElement("p", null, "body")),
  );
}

describe("OnboardingFrame", () => {
  it("wraps its children in the banner, main and contentinfo landmarks with one h1", () => {
    const html = markup({});
    expect(html).toContain("<header>");
    expect(html).toContain("<main>");
    expect(html).toContain("<footer");
    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
    expect(html).toContain("<h1>H</h1>");
    expect(html).toContain('aria-current="step"');
  });

  it("keeps the heading out of sight without dropping it from the outline", () => {
    const html = markup({ hideHeading: true });
    expect(html).toContain('<h1 class="sr-only">');
    expect(html).toContain(">H</h1>");
  });

  it("puts the banner before main and main before the footer", () => {
    const html = markup({});
    const header = html.indexOf("<header>");
    const main = html.indexOf("<main>");
    const footer = html.indexOf("<footer");
    expect(header).toBeGreaterThan(-1);
    expect(header).toBeLessThan(main);
    expect(main).toBeLessThan(footer);
  });
});
