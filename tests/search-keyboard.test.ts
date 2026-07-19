// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  isTypingContext,
  nextSearchResultIndex,
  SEARCH_KEYBOARD_HINTS,
} from "~/lib/search-keyboard";

describe("nextSearchResultIndex", () => {
  it("starts at the first result on the first navigation key", () => {
    expect(nextSearchResultIndex("j", null, 5)).toBe(0);
    expect(nextSearchResultIndex("ArrowDown", null, 5)).toBe(0);
    expect(nextSearchResultIndex("k", null, 5)).toBe(0);
  });

  it("moves forward and backward with j/k and arrows, clamping at both ends", () => {
    expect(nextSearchResultIndex("j", 0, 3)).toBe(1);
    expect(nextSearchResultIndex("ArrowDown", 1, 3)).toBe(2);
    expect(nextSearchResultIndex("j", 2, 3)).toBe(2);
    expect(nextSearchResultIndex("k", 2, 3)).toBe(1);
    expect(nextSearchResultIndex("ArrowUp", 1, 3)).toBe(0);
    expect(nextSearchResultIndex("k", 0, 3)).toBe(0);
  });

  it("returns null for non-navigation keys and empty result lists", () => {
    expect(nextSearchResultIndex("Enter", 0, 3)).toBeNull();
    expect(nextSearchResultIndex("s", 0, 3)).toBeNull();
    expect(nextSearchResultIndex("j", 0, 0)).toBeNull();
  });
});

describe("isTypingContext", () => {
  it("treats inputs, textareas, selects, and contenteditable as typing", () => {
    expect(isTypingContext(document.createElement("input"))).toBe(true);
    expect(isTypingContext(document.createElement("textarea"))).toBe(true);
    expect(isTypingContext(document.createElement("select"))).toBe(true);
    expect(isTypingContext(document.createElement("div"))).toBe(false);
    expect(isTypingContext(document.body)).toBe(false);
    expect(isTypingContext(null)).toBe(false);
  });
});

describe("SEARCH_KEYBOARD_HINTS", () => {
  it("documents every shortcut the listener handles", () => {
    const keys = SEARCH_KEYBOARD_HINTS.map((hint) => hint.keys).join(" ");
    expect(keys).toContain("j / k");
    expect(keys).toContain("Enter");
    expect(keys).toContain("s");
    expect(keys).toContain("?");
  });
});
