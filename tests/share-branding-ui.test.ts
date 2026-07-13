import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logo = "data:image/png;base64,iVBORw0KGgo=";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
});

async function renderShare(brandIdentity: {
  brandName: string | null;
  brandWebsite: string | null;
  brandLogo: string | null;
} | null) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: to }, children),
      useLoaderData: vi.fn().mockReturnValue({
        mode: "live",
        resourceType: "collection",
        collection: { id: "collection-1", name: "Launch board" },
        items: [],
        preparedBy: brandIdentity?.brandName ?? null,
        brandIdentity,
      }),
    };
  });

  const { default: ShareRoute } = await import("~/routes/share.$token");
  return renderToStaticMarkup(createElement(ShareRoute));
}

describe("shared report agency identity", () => {
  it("visibly leads with the entitled Agency logo, name, and safe website", async () => {
    const markup = await renderShare({
      brandName: "Northwind Growth",
      brandWebsite: "https://northwind.example/work",
      brandLogo: logo,
    });

    expect(markup).toContain('class="f9-share-brand-identity"');
    expect(markup).toContain(`src="${logo}"`);
    expect(markup).toContain('alt="Northwind Growth logo"');
    expect(markup).toContain("Northwind Growth");
    expect(markup).toContain('href="https://northwind.example/work"');
    expect(markup).toContain("northwind.example");
    expect(markup).not.toContain('class="f9-app-brand"');
    expect(markup).toContain('class="f9-share-powered-by"');
    expect(markup).toContain("Powered by");
    expect(markup).toContain("Five to Nine");
  });

  it("keeps the Five to Nine header when no entitled identity is present", async () => {
    const markup = await renderShare(null);

    expect(markup).toContain('class="f9-app-brand"');
    expect(markup).toContain("Shared evidence");
    expect(markup).not.toContain('class="f9-share-brand-identity"');
  });

  it("does not turn an unsafe stored website into a public link", async () => {
    const markup = await renderShare({
      brandName: "Northwind Growth",
      brandWebsite: "javascript:alert(1)",
      brandLogo: logo,
    });

    expect(markup).not.toContain("javascript:");
    expect(markup).toContain('alt="Northwind Growth logo"');
  });

  it("declares noindex and nofollow in route metadata", async () => {
    const { meta } = await import("~/routes/share.$token");

    expect(meta()).toEqual(expect.arrayContaining([
      { name: "robots", content: "noindex, nofollow" },
    ]));
  });

  it("keeps identity and attribution in print while hiding only app controls", () => {
    const appCss = readFileSync("app/app.css", "utf8");
    const printCss = appCss.slice(appCss.indexOf("@media print"));

    expect(printCss).toContain(".f9-share-brand-identity");
    expect(printCss).toContain(".f9-share-powered-by");
    expect(printCss).toContain(".f9-report-toolbar button");
    expect(printCss).toContain(".f9-report-toolbar a");
    expect(printCss).not.toMatch(/\.f9-report-toolbar\s*\{[^}]*display:\s*none/);
    expect(printCss).not.toMatch(/\.f9-share-header,[\s\S]{0,160}display:\s*none/);
  });
});
