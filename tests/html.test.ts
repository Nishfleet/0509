import { describe, expect, it } from "vitest";

import { escapeHtml } from "../app/lib/html";

describe("escapeHtml", () => {
  it.each([
    ["&", "&amp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ['"', "&quot;"],
    ["'", "&#39;"],
  ])("maps %s to %s", (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });

  it("escapes the ampersand first so an existing entity stays literal in the HTML", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("escapes every one of the five characters in a mixed string", () => {
    expect(escapeHtml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("escapes a hostile string without dropping any of its characters", () => {
    expect(escapeHtml("\"><script>alert('x')</script>")).toBe(
      "&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;",
    );
  });

  it("returns the empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(escapeHtml("Five to Nine")).toBe("Five to Nine");
  });
});
