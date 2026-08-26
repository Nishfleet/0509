import { describe, expect, it } from "vitest";

import { stripAllTags, stripScriptAndStyle } from "~/lib/sanitize-text.server";

function hasRunnableScriptToken(value: string): boolean {
  return />[^<]*script[^>]*</i.test(value);
}

function hasCommentOpenToken(value: string): boolean {
  return /<!--/.test(value);
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

  it("strips script openers with attributes and their content", () => {
    expect(stripped("<script foo=\"bar\">alert(1)</script>")).toBe("");
    expect(stripped("<script type=\"text/javascript\" src=\"//evil/x.js\"></script>")).toBe("");
  });

  it("strips self-closing-style script closers (</script/>)", () => {
    expect(stripped("<script>alert(1)</script/>")).toBe("");
    expect(stripped("<script>alert(1)</script />")).toBe("");
  });

  it("strips script blocks with unicode-escaped openers inside the element", () => {
    expect(stripped("<script src=//evil.example/x.js>\u003c/script>")).toBe("");
    expect(stripped("<script src=//evil.example/x.js>\u003c/script foo>")).toBe("");
  });

  it("strips nested script tag smuggling without leaving a runnable script element", () => {
    const result = stripScriptAndStyle("<scr<script>ipt>alert(1)</script>");
    expect(hasRunnableScriptToken(result)).toBe(false);
    expect(result).not.toMatch(/<script/i);
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

  it("removes a bare unclosed comment opener (<!--)", () => {
    const result = stripped("safe<!-- text");
    expect(hasCommentOpenToken(result)).toBe(false);
    expect(result).toBe("safe text");
  });

  it("removes nested HTML comments without leaving a comment opener behind", () => {
    const result = stripped("<!-- nested <!-- inner --> -->safe");
    expect(hasCommentOpenToken(result)).toBe(false);
    expect(result).toBe("safe");
  });

  it("does not re-introduce <!-- across smuggled comment delimiters", () => {
    const result = stripScriptAndStyle("<!--<!- text -->safe");
    expect(hasCommentOpenToken(result)).toBe(false);
  });
});

describe("stripAllTags", () => {
  const stripped = (value: string) => stripAllTags(value);

  it("removes every HTML tag and leaves text content", () => {
    expect(stripped("<p>hello <b>world</b></p>")).toBe("hello world");
  });

  it("strips smuggled tags so <script> cannot re-form after a single pass", () => {
    const result = stripped("<scri<script>pt>alert(1)</script>");
    expect(hasRunnableScriptToken(result)).toBe(false);
    expect(result).not.toMatch(/<script/i);
  });

  it("strips re-introduced script tags from the CodeQL worked example", () => {
    const result = stripped("<scrip<script>is removed</script>t>alert(123)</script>");
    expect(hasRunnableScriptToken(result)).toBe(false);
    expect(result).not.toMatch(/<script/i);
  });

  it("preserves text that contains no tags", () => {
    expect(stripped("plain text only")).toBe("plain text only");
  });
});
