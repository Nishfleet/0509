import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SWITCH_PAGES, SWITCH_SLUGS } from "~/lib/switch-pages";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

/**
 * Issue #3161 — the SwitchFromStrip label ("Switch from") carries the
 * preposition, so each strip link renders the bare product name. Rendering
 * `from {productName}` per link produced "Switch from from Panoramata …" on
 * /search and /competitor-monitoring. The inline `SwitchFromLinks` variant
 * used inside MarketingNav keeps its "from <Product>" link text.
 */

function mockLink(React: typeof import("react")) {
  return ({ children, to, ...props }: MockLinkProps) =>
    React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
});

async function renderStrip(): Promise<string> {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return { ...actual, Link: mockLink(React) };
  });
  const { SwitchFromStrip } = await import("~/components/switch-from-links");
  return renderToStaticMarkup(createElement(SwitchFromStrip));
}

async function renderInlineLinks(): Promise<string> {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return { ...actual, Link: mockLink(React) };
  });
  const { SwitchFromLinks } = await import("~/components/switch-from-links");
  return renderToStaticMarkup(createElement(SwitchFromLinks));
}

describe("SwitchFromStrip preposition contract (issue #3161)", () => {
  it("renders the label once and keeps the nav aria-label", async () => {
    const markup = await renderStrip();
    expect(markup).toContain('aria-label="Switch from"');
    const labelSpans = markup.match(/<span[^>]*class="ld-switch-from-label"[^>]*>/g) ?? [];
    expect(labelSpans.length).toBe(1);
    const labelText = markup.match(/<span[^>]*class="ld-switch-from-label"[^>]*>([^<]*)<\/span>/)?.[1];
    expect(labelText).toBe("Switch from");
  });

  it("no link text inside the strip begins with 'from '", async () => {
    const markup = await renderStrip();
    const linkTexts = [...markup.matchAll(/<a[^>]*class="ld-switch-from-link"[^>]*>([^<]*)<\/a>/g)].map(
      (m) => m[1],
    );
    expect(linkTexts.length).toBe(SWITCH_SLUGS.length);
    for (const text of linkTexts) {
      expect(text.startsWith("from ")).toBe(false);
    }
    const visible = markup
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    expect(visible).not.toMatch(/switch from\s+from/i);
  });

  it("keeps the /switch/<slug> hrefs unchanged for every SWITCH_SLUGS entry", async () => {
    const markup = await renderStrip();
    for (const slug of SWITCH_SLUGS) {
      const page = SWITCH_PAGES[slug];
      expect(markup).toContain(`href="${page.pathname}"`);
      expect(markup).toContain(`>${page.productName}</a>`);
    }
  });

  it("the inline MarketingNav variant keeps its 'from <Product>' link text", async () => {
    const markup = await renderInlineLinks();
    for (const slug of SWITCH_SLUGS) {
      const page = SWITCH_PAGES[slug];
      expect(markup).toContain(`>from ${page.productName}</a>`);
      expect(markup).toContain(`href="${page.pathname}"`);
    }
  });
});
