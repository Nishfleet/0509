import { describe, expect, it } from "vitest";

import { toggleVariants } from "../app/components/ui/toggle";

// The toggle is skin-only, so its whole contract is the class list. cva
// concatenates the base classes with the variant classes, and every one of
// those strings has to stay: a dropped `group/toggle` breaks the icon's own
// hover group, and a dropped height class collapses the button.

describe("toggleVariants", () => {
  it("gives the default variant a transparent background and the default size height", () => {
    const classes = toggleVariants();
    expect(classes).toContain("bg-transparent");
    expect(classes).toContain("h-8");
  });

  it("gives the outline variant a border on a transparent background", () => {
    expect(toggleVariants({ variant: "outline" })).toContain("border");
    expect(toggleVariants({ variant: "outline" })).toContain("bg-transparent");
  });

  it("gives sm the h-7 height and lg the h-9 height", () => {
    expect(toggleVariants({ size: "sm" })).toContain("h-7");
    expect(toggleVariants({ size: "lg" })).toContain("h-9");
  });

  it("keeps the toggle group class on every output", () => {
    for (const classes of [
      toggleVariants(),
      toggleVariants({ variant: "outline" }),
      toggleVariants({ size: "sm" }),
      toggleVariants({ size: "lg" }),
    ]) {
      expect(classes).toContain("group/toggle");
    }
  });
});
