import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { RivalNudge } from "../../app/components/rival-nudge";
import { nudgeLine } from "../../app/lib/rival-nudge";

describe("rival nudge line", () => {
  it("says one competitor or none, calmly", () => {
    expect(nudgeLine(1)).toBe(
      "You are watching one competitor. Add another and your ranking has more to compare you with.",
    );
    expect(nudgeLine(0)).toContain("not watching a competitor yet");
  });

  it("links to the competitors page", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RivalNudge, { rivals: 1 })));
    expect(html).toContain('data-home="rival-nudge"');
    expect(html).toContain('href="/app/competitors"');
  });
});
