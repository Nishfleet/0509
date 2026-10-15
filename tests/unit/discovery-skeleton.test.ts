import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiscoverySkeleton } from "../../app/components/discovery-skeleton";

describe("DiscoverySkeleton", () => {
  it("draws three placeholder rows that a screen reader skips", () => {
    const html = renderToStaticMarkup(createElement(DiscoverySkeleton));

    expect(html).toContain('aria-hidden="true"');
    expect(html.match(/<li\b/g) ?? []).toHaveLength(3);
  });

  it("does not animate, so reduced motion has nothing to turn off", () => {
    const html = renderToStaticMarkup(createElement(DiscoverySkeleton));

    expect(html).not.toMatch(/animate-|transition/);
  });
});
