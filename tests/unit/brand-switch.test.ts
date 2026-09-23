import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BrandSwitch,
  ON_CONSEQUENCE,
  brandSwitchView,
  pausedLine,
  type BrandSwitchState,
} from "../../app/components/brand-switch";

/**
 * Nishfleet/0509#4017, DESIGN.md 6.
 *
 * Three states on every screen. Acceptance that the control is operable, that
 * You is not, that the hit area is 44px, and that Tab reaches it and Space
 * toggles it, lives in `e2e/brand-switch.spec.ts`, where a real browser
 * queries by role. Here the unit test reads the rendered copy through a
 * single source-of-truth (`brandSwitchView`, `pausedLine`), so the assertions
 * are about what the row says, not how the markup happens to serialise.
 */

function row(props: Parameters<typeof BrandSwitch>[0]): string {
  return renderToStaticMarkup(createElement(BrandSwitch, props));
}

describe("the per-brand switch renders DESIGN.md 6's three states", () => {
  it("On is checked, operable, prints the consequence before it is touched, and has no paused line", () => {
    const view = brandSwitchView("on");
    const html = row({ name: "Casetta", state: "on" });
    expect(view).toEqual({ checked: true, operable: true, label: "ON" });
    expect(html).toContain('data-state="on"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain(ON_CONSEQUENCE);
    expect(html).not.toContain("paused");
    expect(html.toLowerCase()).not.toContain("confirm");
  });

  it("Off is unchecked and operable, and prints the pause date with history kept", () => {
    const view = brandSwitchView("off");
    const html = row({ name: "Casetta", state: "off", pausedOn: "12 Sep" });
    expect(view).toEqual({ checked: false, operable: true, label: "OFF" });
    expect(html).toContain('data-state="off"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain(pausedLine("12 Sep"));
    expect(html).not.toContain(ON_CONSEQUENCE);
    expect(html.toLowerCase()).not.toContain("confirm");
  });

  it("You is checked and carries the disabled attribute, so it is visible but not operable", () => {
    const view = brandSwitchView("you");
    const html = row({ name: "Loopwell", state: "you" });
    expect(view).toEqual({ checked: true, operable: false, label: "YOU" });
    expect(html).toContain('data-state="you"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("disabled");
    expect(html).not.toContain("paused");
    expect(html).not.toContain(ON_CONSEQUENCE);
  });

  it("keeps the state word inside the switch slot, so the label is part of the hit area", () => {
    for (const state of ["on", "off", "you"] as const) {
      const html =
        state === "off"
          ? row({ name: "Casetta", state: "off", pausedOn: "12 Sep" })
          : state === "you"
            ? row({ name: "Casetta", state: "you" })
            : row({ name: "Casetta", state: "on" });
      const switchAt = html.indexOf('data-slot="switch"');
      const wordAt = html.indexOf(`>${brandSwitchView(state).label}<`);
      expect(switchAt, "switch slot exists").toBeGreaterThanOrEqual(0);
      expect(wordAt, "state word sits inside the switch").toBeGreaterThan(switchAt);
    }
  });

  it("falls back to the brand initial when the monogram is blank", () => {
    const html = row({ name: "Casetta", monogram: "  ", state: "on" });
    const monogram = html.slice(html.indexOf('data-slot="monogram"'), html.indexOf('data-slot="chip"'));
    expect(monogram).toContain(">C<");
  });
});

describe("pausedLine trims a date and keeps history kept", () => {
  it("formats the sub-line for the day given", () => {
    expect(pausedLine("12 Sep")).toBe("paused 12 Sep · history kept");
  });

  it("trims surrounding whitespace on the date", () => {
    expect(pausedLine("  12 Sep  ")).toBe("paused 12 Sep · history kept");
  });
});

describe("the three states exhaust the state union", () => {
  it.each<BrandSwitchState>(["on", "off", "you"])("%s has a defined view", (state) => {
    const view = brandSwitchView(state);
    expect(["ON", "OFF", "YOU"]).toContain(view.label);
    expect(typeof view.checked).toBe("boolean");
    expect(typeof view.operable).toBe("boolean");
  });
});
