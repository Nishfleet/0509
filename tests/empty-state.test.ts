import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { degradedSource, EmptyState, fewerThanTwoOnBrands, quietWeek } from "../app/components/empty-state";
import type { EmptyStateAction } from "../app/components/empty-state";

function renderEmptyState(sentence: string, action?: EmptyStateAction): string {
  return renderToStaticMarkup(createElement(EmptyState, { sentence, action }));
}

describe("EmptyState", () => {
  it.each(["No data.", " nothing here! ", '"No data"'])("throws renders no truth for %s", (sentence) => {
    expect(() => renderEmptyState(sentence)).toThrow("renders no truth");
  });

  it.each(["//evil.example", "https://evil.example"])("throws same-site path for %s", (href) => {
    expect(() => renderEmptyState("See the details.", { kind: "link", label: "Open", href })).toThrow("same-site path");
  });

  it("renders a same-site link href", () => {
    const html = renderEmptyState("See the details.", { kind: "link", label: "Open", href: "/app" });
    expect(html).toContain('href="/app"');
  });

  it("renders an input action with the given name and placeholder", () => {
    const html = renderEmptyState("Add a competitor to see where you stand.", fewerThanTwoOnBrands().action);
    expect(html).toContain("<input");
    expect(html).toContain('name="competitor"');
    expect(html).toContain('placeholder="their website or social username"');
  });
});

describe("quietWeek", () => {
  it("pluralises mentions and site changes", () => {
    expect(quietWeek(1, 1).sentence).toContain("1 mention and 1 site change");
    expect(quietWeek(0, 2).sentence).toContain("0 mentions and 2 site changes");
  });

  it("links to /app", () => {
    expect(quietWeek(0, 2).action).toEqual({ kind: "link", label: "See the details", href: "/app" });
  });
});

describe("degradedSource", () => {
  it("builds the sentence", () => {
    expect(degradedSource("Reddit", "slow since 06:00").sentence).toBe(
      "Reddit has been slow since 06:00. The count may be incomplete.",
    );
  });
});
