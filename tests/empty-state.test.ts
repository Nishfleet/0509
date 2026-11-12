import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { EmptyState } from "../app/components/empty-state";
import type { EmptyStateAction } from "../app/components/empty-state";

function renderEmptyState(sentence: string, action?: EmptyStateAction): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(EmptyState, { sentence, action })));
}

describe("EmptyState", () => {
  it.each(["//evil.example", "https://evil.example"])("rejects off-site href %s", (href) => {
    expect(() => renderEmptyState("See the details.", { kind: "link", label: "Open", href })).toThrow("same-site path");
  });
});
