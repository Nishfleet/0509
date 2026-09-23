import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandSwitch, type BrandSwitchState } from "../../app/components/brand-switch";

function render(state: BrandSwitchState): string {
  return renderToStaticMarkup(
    createElement(BrandSwitch, { state, brandName: "Loopwell" }),
  );
}

describe("the brand switch", () => {
  it("renders on: checked, operable, labelled ON", () => {
    const html = render("on");
    expect(html.startsWith("<label")).toBe(true);
    expect(html).toContain('data-state="on"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain(">ON<");
    expect(html).toContain("min-h-11");
    expect(html).not.toContain('data-disabled=""');
  });

  it("renders off: unchecked, operable, labelled OFF", () => {
    const html = render("off");
    expect(html.startsWith("<label")).toBe(true);
    expect(html).toContain('data-state="off"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain(">OFF<");
    expect(html).not.toContain('data-disabled=""');
  });

  it("renders you: checked, not operable, labelled YOU", () => {
    const html = render("you");
    expect(html.startsWith("<label")).toBe(true);
    expect(html).toContain('data-state="you"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain(">YOU<");
    expect(html).toContain('data-disabled=""');
  });
});
