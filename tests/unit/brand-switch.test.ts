import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandSwitch, ON_CONSEQUENCE, type BrandSwitchState } from "../../app/components/brand-switch";

function markup(state: BrandSwitchState, pausedOn = "12 Sep"): string {
  return renderToStaticMarkup(createElement(BrandSwitch, { name: "Casetta", state, pausedOn }));
}

function elementWithMarker(html: string, marker: string): string {
  const markerAt = html.indexOf(marker);
  if (markerAt < 0) throw new Error(`the row has no ${marker}`);
  const openAt = html.lastIndexOf("<", markerAt);
  const tag = /^<([a-zA-Z0-9]+)/.exec(html.slice(openAt))?.[1];
  if (tag === undefined) throw new Error("the switch tag has no name");
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
  re.lastIndex = openAt;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    if (match[0].endsWith("/>")) continue;
    depth += match[1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(openAt, match.index + match[0].length);
  }
  throw new Error("the switch element does not close");
}

function elementWithRole(html: string, role: string): string {
  return elementWithMarker(html, `role="${role}"`);
}

function openingTag(element: string): string {
  const tag = /^<[^>]+>/.exec(element)?.[0];
  if (tag === undefined) throw new Error("the switch has no opening tag");
  return tag;
}

function isOperable(element: string): boolean {
  const open = openingTag(element);
  const disabledAttr = /(?:^|\s)(?:disabled|aria-disabled="true"|data-disabled(?:=|>|\s))/.test(open);
  return !disabledAttr;
}

describe("per-brand switch", () => {
  it("renders On checked and operable, with the consequence beside it and no paused date", () => {
    const html = markup("on");
    const control = elementWithRole(html, "switch");
    expect(html).toContain('data-state="on"');
    expect(control).toContain(">ON<");
    expect(openingTag(control)).toContain('aria-checked="true"');
    expect(openingTag(control)).toContain('aria-label="Casetta"');
    expect(openingTag(control)).not.toContain("ON");
    expect(isOperable(control)).toBe(true);
    expect(html).toContain(ON_CONSEQUENCE);
    expect(html).not.toContain("paused");
    expect(html.toLowerCase()).not.toContain("confirm");
  });

  it("renders Off unchecked and operable, and says the brand is paused with its history kept", () => {
    const html = markup("off");
    const control = elementWithRole(html, "switch");
    expect(html).toContain('data-state="off"');
    expect(control).toContain(">OFF<");
    expect(openingTag(control)).toContain('aria-checked="false"');
    expect(openingTag(control)).toContain('aria-label="Casetta"');
    expect(isOperable(control)).toBe(true);
    expect(html).toContain("paused 12 Sep · history kept");
    expect(html).not.toContain(ON_CONSEQUENCE);
    expect(html.toLowerCase()).not.toContain("confirm");
  });

  it("renders You checked, visible, and not operable", () => {
    const html = markup("you");
    const control = elementWithRole(html, "switch");
    expect(html).toContain('data-state="you"');
    expect(control).toContain(">YOU<");
    expect(openingTag(control)).toContain('aria-checked="true"');
    expect(openingTag(control)).toContain('aria-label="Casetta"');
    expect(isOperable(control)).toBe(false);
    expect(html).not.toContain("paused");
    expect(html).not.toContain(ON_CONSEQUENCE);
    expect(html.toLowerCase()).not.toContain("confirm");
  });

  it("says history is kept when Off has no date", () => {
    const html = renderToStaticMarkup(createElement(BrandSwitch, { name: "Casetta", state: "off" }));
    expect(html).toContain("paused · history kept");
    expect(html).not.toContain("paused 12 Sep");
  });

  it("uses the brand initial when the monogram is blank", () => {
    const html = renderToStaticMarkup(
      createElement(BrandSwitch, { name: "Casetta", monogram: "  ", state: "on" }),
    );
    const monogram = elementWithMarker(html, 'data-slot="monogram"');
    expect(monogram).toContain(">C<");
    expect(monogram).not.toContain(">ON<");
  });

  it("keeps the state label inside the switch, so the label is part of the hit area", () => {
    for (const state of ["on", "off", "you"] as const) {
      const control = elementWithRole(markup(state), "switch");
      const label = state === "on" ? "ON" : state === "off" ? "OFF" : "YOU";
      expect(control).toContain(`>${label}<`);
    }
  });
});
