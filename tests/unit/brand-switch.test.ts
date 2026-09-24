import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BrandSwitch,
  type BrandSwitchState,
  brandRowClass,
  BrandSwitchField,
  brandSwitchNote,
} from "../../app/components/brand-switch";

function render(state: BrandSwitchState): string {
  return renderToStaticMarkup(
    createElement(BrandSwitch, { state, brandName: "Loopwell" }),
  );
}

function renderField(state: BrandSwitchState, pausedOn: Date | null): string {
  return renderToStaticMarkup(
    createElement(BrandSwitchField, { state, brandName: "Loopwell", pausedOn }),
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

describe("the brand switch note", () => {
  it("prints the consequence for on: off pauses tracking, history kept", () => {
    expect(brandSwitchNote("on", null)).toBe("Off stops the watching and the alerts. The history stays, and turning it back on picks up where it left off.");
  });

  it("prints the paused date for off from the UTC instant", () => {
    expect(brandSwitchNote("off", new Date("2026-09-22T12:00:00Z"))).toBe("paused 22 Sept · history kept");
    expect(brandSwitchNote("off", null)).toBe("paused · history kept");
  });

  it("marks you as always tracked", () => {
    expect(brandSwitchNote("you", null)).toBe("Your brand · always tracked");
  });
});

describe("brandRowClass", () => {
  it("dims off rows, washes you rows and leaves on rows alone", () => {
    expect(brandRowClass("off")).toBe("text-ink-faint");
    expect(brandRowClass("you")).toBe("bg-green-wash");
    expect(brandRowClass("on")).toBe("");
  });
});

describe("the brand switch field", () => {
  it("prints the consequence next to the control with no confirmation", () => {
    const html = renderField("off", new Date("2026-09-22T12:00:00Z"));
    expect(html).toContain('data-slot="brand-switch-field"');
    expect(html).toContain('data-slot="brand-switch"');
    expect(html).toContain("paused 22 Sept · history kept");
    expect(html).not.toContain('role="dialog"');
  });

  it("renders the note in every state", () => {
    expect(renderField("on", null)).toContain("Off stops the watching and the alerts.");
    expect(renderField("you", null)).toContain("Your brand · always tracked");
    expect(renderField("off", null)).toContain("paused · history kept");
  });
});
