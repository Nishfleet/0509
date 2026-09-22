import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandSwitch, type BrandSwitchState } from "../../app/components/brand-switch";

const STATES = ["on", "off", "you"] as const satisfies readonly BrandSwitchState[];

function markup(state: BrandSwitchState, pausedOn = "12 Sep") {
  return renderToStaticMarkup(
    createElement(BrandSwitch, { name: "Casetta", state, pausedOn }),
  );
}

function slot(html: string, name: string) {
  const match = new RegExp(`data-slot="${name}"[^>]*>`).exec(html);
  return match?.[0] ?? "";
}

describe("per-brand switch", () => {
  it("has three states and no dismissed state", () => {
    expect(STATES).toEqual(["on", "off", "you"]);
  });

  it("renders On with the consequence already beside the control", () => {
    const html = markup("on");
    expect(html).toContain('data-state="on"');
    expect(slot(html, "state-label")).toBeTruthy();
    expect(html).toContain(">ON<");
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain('disabled=""');
    expect(slot(html, "hit")).toContain("min-h-[44px]");
    expect(slot(html, "hit")).toContain("min-w-[44px]");
    expect(html).toContain("paused 12 Sep · history kept");
    expect(slot(html, "monogram")).toContain("border-ink");
    expect(slot(html, "chip")).not.toContain("border-dashed");
  });

  it("renders Off dimmed, with a dashed chip, a line-coloured monogram, and the paused line", () => {
    const html = markup("off");
    expect(html).toContain('data-state="off"');
    expect(html).toContain(">OFF<");
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("text-ink-faint");
    expect(slot(html, "monogram")).toContain("border-line");
    expect(slot(html, "monogram")).not.toContain("border-ink");
    expect(slot(html, "chip")).toContain("border-dashed");
    expect(html).toContain("paused 12 Sep · history kept");
  });

  it("renders You visible and not operable", () => {
    const html = markup("you");
    expect(html).toContain('data-state="you"');
    expect(html).toContain(">YOU<");
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain("bg-accent-wash");
    expect(html).not.toContain('data-slot="consequence"');
    expect(slot(html, "state-label")).toContain(">");
  });
});
