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

  it("escapes the ampersand first so an existing entity is not double-decoded", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves no raw markup characters from a hostile string", () => {
    const escaped = escapeHtml("\"><script>alert('x')</script>");

    expect(escaped).not.toMatch(/[<>"']/);
    expect(escaped).toContain("&lt;script&gt;");
    expect(escaped).toContain("&#39;x&#39;");
  });

  it("returns the empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(escapeHtml("Five to Nine")).toBe("Five to Nine");
  });
});
