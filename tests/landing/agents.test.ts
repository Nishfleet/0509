import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Agents } from "../../app/components/landing/agents";
import { MCP_URL } from "../../app/lib/public-routes";

function markup(): string {
  return renderToStaticMarkup(createElement(Agents));
}

describe("landing agents", () => {
  it("is its own section with the MCP URL, the three client names as text and one example question", () => {
    const html = markup();
    expect(html).toContain('id="agents"');
    expect(html).toContain(MCP_URL);
    for (const name of ["Claude", "Cursor", "ChatGPT"]) {
      expect(html).toContain(`>${name}<`);
    }
    expect(html).toContain("Where do I stand this week, and what changed?");
  });

  it("links to the API docs instead of embedding them, and says agent reads are part of every plan", () => {
    const html = markup();
    expect(html).toContain('href="/api/v1/openapi.json"');
    expect(html).toContain("Read the API docs");
    expect(html).not.toContain("<iframe");
    // The three names are text pills, never another company's mark.
    expect(html).not.toContain("<img");
    expect(html).toContain("part of every plan");
  });
});
