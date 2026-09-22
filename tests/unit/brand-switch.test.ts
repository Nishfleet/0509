import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandSwitch, ON_CONSEQUENCE, type BrandSwitchState } from "../../app/components/brand-switch";

function markup(state: BrandSwitchState, pausedOn = "12 Sep"): string {
  return renderToStaticMarkup(createElement(BrandSwitch, { name: "Casetta", state, pausedOn }));
}

function switchButton(html: string): string {
  const match = /<button\b[^>]*\brole="switch"[^>]*>[\s\S]*?<\/button>/.exec(html);
  if (match === null) throw new Error("the row has no switch");
  return match[0];
}

function isOperable(button: string): boolean {
  return !/\sdisabled(?:=|>|\s)/.test(button);
}

describe("per-brand switch", () => {
  it("renders On checked and operable, with the consequence beside it and no paused date", () => {
    const html = markup("on");
    const button = switchButton(html);
    expect(html).toContain('data-state="on"');
    expect(button).toContain(">ON<");
    expect(button).toContain('aria-checked="true"');
    expect(isOperable(button)).toBe(true);
    expect(html).toContain(ON_CONSEQUENCE);
    expect(html).not.toContain("paused");
    expect(html.toLowerCase()).not.toContain("confirm");
  });

  it("renders Off unchecked and operable, and says the brand is paused with its history kept", () => {
    const html = markup("off");
    const button = switchButton(html);
    expect(html).toContain('data-state="off"');
    expect(button).toContain(">OFF<");
    expect(button).toContain('aria-checked="false"');
    expect(isOperable(button)).toBe(true);
    expect(html).toContain("paused 12 Sep · history kept");
    expect(html).not.toContain(ON_CONSEQUENCE);
    expect(html.toLowerCase()).not.toContain("confirm");
  });

  it("renders You checked, visible, and not operable", () => {
    const html = markup("you");
    const button = switchButton(html);
    expect(html).toContain('data-state="you"');
    expect(button).toContain(">YOU<");
    expect(button).toContain('aria-checked="true"');
    expect(isOperable(button)).toBe(false);
    expect(html).not.toContain("paused");
    expect(html).not.toContain(ON_CONSEQUENCE);
    expect(html.toLowerCase()).not.toContain("confirm");
  });

  it("keeps the state label inside the switch, so the label is part of the hit area", () => {
    for (const state of ["on", "off", "you"] as const) {
      const button = switchButton(markup(state));
      const label = state === "on" ? "ON" : state === "off" ? "OFF" : "YOU";
      expect(button).toContain(`>${label}<`);
    }
  });

  it("does not render a dismissed suggestion as a switch state", () => {
    for (const state of ["on", "off", "you"] as const) {
      expect(markup(state)).not.toContain("dismissed");
    }
  });
});
