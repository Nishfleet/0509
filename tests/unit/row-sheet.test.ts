import { describe, expect, it } from "vitest";

import {
  ROW_SHEET_BREAKPOINT_PX,
  rowExpansionModeForWidth,
} from "../../app/components/row-sheet";

const WIDTHS: [viewport: number, mode: "sheet" | "in-place"][] = [
  [0, "sheet"],
  [320, "sheet"],
  [390, "sheet"],
  [768, "sheet"],
  [859, "sheet"],
  [860, "in-place"],
  [861, "in-place"],
  [1080, "in-place"],
  [1440, "in-place"],
  [2560, "in-place"],
];

describe("row expansion is a sheet below 860px and in place above it (#4021)", () => {
  it.each(WIDTHS)("gives a %ipx viewport the %s expansion", (width, mode) => {
    expect(rowExpansionModeForWidth(width)).toBe(mode);
  });

  it("puts the boundary at the 860px DESIGN.md §8 pins", () => {
    // The boundary belongs to the wider branch: 860 itself expands in place and
    // the pixel one below it opens a sheet.
    expect(ROW_SHEET_BREAKPOINT_PX).toBe(860);
    expect(rowExpansionModeForWidth(ROW_SHEET_BREAKPOINT_PX - 1)).toBe("sheet");
    expect(rowExpansionModeForWidth(ROW_SHEET_BREAKPOINT_PX)).toBe("in-place");
  });
});
