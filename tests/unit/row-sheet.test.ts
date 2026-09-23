import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ROW_SHEET_BREAKPOINT_PX,
  rowExpansionModeForWidth,
  rowSheetWidthQuery,
} from "../../app/components/row-sheet";

// The decision half of 0509#4021's "Build" bullets 2-4, asserted without a
// browser. The rendering half — that tapping a row opens a sheet, that focus
// moves and returns, that Escape closes it, and that the 380ms/280ms budget is
// on the live DOM — is e2e/row-sheet.spec.ts, because a jsdom-free node project
// cannot honestly answer a question about computed style or focus.

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

describe("row expansion is a sheet below 860px and in place above it (#4021)", () => {
  it("picks the sheet for every width below the breakpoint", () => {
    for (const width of [0, 320, 390, 768, 859]) {
      expect(rowExpansionModeForWidth(width)).toBe("sheet");
    }
  });

  it("picks in-place expansion at and above the breakpoint", () => {
    for (const width of [860, 861, 1080, 1440, 2560]) {
      expect(rowExpansionModeForWidth(width)).toBe("in-place");
    }
  });

  it("puts the boundary exactly at the breakpoint DESIGN.md §8 names", () => {
    expect(ROW_SHEET_BREAKPOINT_PX).toBe(860);
    expect(rowExpansionModeForWidth(ROW_SHEET_BREAKPOINT_PX - 1)).toBe("sheet");
    expect(rowExpansionModeForWidth(ROW_SHEET_BREAKPOINT_PX)).toBe("in-place");
  });

  it("builds the matchMedia query from the constant, so the breakpoint cannot drift", () => {
    expect(rowSheetWidthQuery()).toBe(`(min-width: ${String(ROW_SHEET_BREAKPOINT_PX)}px)`);
  });
});

describe("the sheet's motion reads the @theme tokens, not a second copy (#4021)", () => {
  it("keeps both sheet durations and the curve in app/app.css alone", async () => {
    const css = await readFile(path.join(REPO_ROOT, "app/app.css"), "utf8");
    const bean = (name: string): string => {
      const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
      if (match === null) throw new Error(`app/app.css has no --${name} token`);
      return match[1].trim();
    };
    expect(bean("duration-sheet-up")).toBe("380ms");
    expect(bean("duration-sheet-down")).toBe("280ms");
    expect(bean("ease-push")).toBe("cubic-bezier(.32, .72, 0, 1)");
  });
});
