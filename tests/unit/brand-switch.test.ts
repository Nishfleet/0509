import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BrandSwitch,
  brandsStillListed,
  ON_CONSEQUENCE,
  type BrandSwitchState,
} from "../../app/components/brand-switch";

function markup(state: BrandSwitchState, pausedOn = "12 Sep") {
  return renderToStaticMarkup(createElement(BrandSwitch, { name: "Casetta", state, pausedOn }));
}

function classes(html: string, slot: string): string[] {
  const match = new RegExp(`data-slot="${slot}"[^>]*class="([^"]*)"`).exec(html);
  return (match?.[1] ?? "").split(/\s+/).filter(Boolean);
}

describe("per-brand switch", () => {
  it("renders On checked and operable, with the consequence and no paused date", () => {
    const html = markup("on");
    expect(html).toContain('data-state="on"');
    expect(html).toContain(">ON<");
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain(ON_CONSEQUENCE);
    expect(html).not.toContain("paused");
    expect(classes(html, "track")).toContain("bg-accent");
    expect(classes(html, "track")).not.toContain("bg-card");
    expect(classes(html, "track")).not.toContain("bg-accent-wash");
    expect(classes(html, "thumb")).toContain("translate-x-[16px]");
  });

  it("renders Off unchecked, dimmed, dashed, and paused, with the thumb on the left", () => {
    const html = markup("off");
    expect(html).toContain('data-state="off"');
    expect(html).toContain(">OFF<");
    expect(html).toContain('aria-checked="false"');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain("text-ink-faint");
    expect(classes(html, "monogram")).toContain("border-line");
    expect(classes(html, "monogram")).not.toContain("border-ink");
    expect(classes(html, "chip")).toContain("border-dashed");
    expect(html).toContain("paused 12 Sep · history kept");
    expect(html).not.toContain(ON_CONSEQUENCE);
    expect(classes(html, "track")).toEqual(expect.arrayContaining(["bg-card", "border-ink"]));
    expect(classes(html, "track")).not.toContain("bg-accent");
    expect(classes(html, "thumb")).toContain("translate-x-0");
    expect(classes(html, "thumb")).not.toContain("translate-x-[16px]");
  });

  it("renders You visible, checked, and not operable", () => {
    const html = markup("you");
    expect(html).toContain('data-state="you"');
    expect(html).toContain(">YOU<");
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('data-slot="consequence"');
    expect(html).not.toContain("paused");
    expect(html).not.toContain(ON_CONSEQUENCE);
    expect(classes(html, "track")).toContain("bg-accent-wash");
    expect(classes(html, "track")).not.toContain("bg-accent");
    expect(classes(html, "thumb")).toContain("translate-x-[16px]");
  });

  it("drops a dismissed suggestion from the list", () => {
    const listed = brandsStillListed([
      { name: "Kindred", state: "on" },
      { name: "Gone", state: "dismissed" },
      { name: "Loopwell", state: "you" },
      { name: "Casetta", state: "off" },
    ]);
    expect(listed.map((row) => row.name)).toEqual(["Kindred", "Loopwell", "Casetta"]);
    expect(listed.some((row) => row.state === "dismissed")).toBe(false);
  });
});
