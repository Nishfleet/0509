import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { DashboardPage } from "~/components/dashboard-page";
import { Pill } from "~/components/pill";

const appCss = readFileSync("app/app.css", "utf8");

function styleRulesFor(selectorFragment: string) {
  const cssWithoutComments = appCss.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...cssWithoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.includes(selectorFragment))
    .map(([, selector, body]) => ({ selector, body }));
}

/**
 * BL-005 — the shell adopts the foundation: the header action slot is the
 * page's single Rank-1 (brief §5, DESIGN.md WP-A3), and the Plain volume
 * (brief §3) is a shell flag rather than a fourth set of styles.
 */

function renderRouted(element: React.ReactElement): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
  return renderToStaticMarkup(<Stub initialEntries={["/"]} />);
}

describe("DashboardPage volume", () => {
  it("stamps the workspace volume by default and keeps the existing class", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage>
        <p>Body</p>
      </DashboardPage>,
    );

    expect(markup).toContain('class="f9-dash-content"');
    expect(markup).toContain('data-wk-volume="workspace"');
  });

  it("stamps the plain volume for long-dwell settings surfaces", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage volume="plain" className="f9-account">
        <p>Body</p>
      </DashboardPage>,
    );

    expect(markup).toContain('class="f9-dash-content f9-account"');
    expect(markup).toContain('data-wk-volume="plain"');
  });
});

describe("workspace kicker", () => {
  it("keeps the shared kicker monochrome in both themes", () => {
    // The kicker vocabulary is f9-wk-kick since the CSS endgame swap.
    expect(appCss).toMatch(
      /\.f9-wk-kick\s*\{[^}]*color:\s*var\(--ink-faint\);/s,
    );
    const darkThemeKickerRules = styleRulesFor(".f9-wk-kick").filter(({ selector }) =>
      /data-f9-theme\s*=\s*(?:"dark"|'dark'|dark)/.test(selector),
    );
    expect(darkThemeKickerRules).toEqual([]);
  });
});

describe("Pill stamp variant", () => {
  it("adds the Evidence Desk state stamp without disturbing the existing families", () => {
    expect(renderToStaticMarkup(<Pill variant="stamp" state="caught">Caught</Pill>)).toContain(
      'class="f9-evidence-stamp is-caught"',
    );
    expect(renderToStaticMarkup(<Pill variant="stamp" state="quiet">Quiet</Pill>)).toContain(
      'class="f9-evidence-stamp is-quiet"',
    );
    expect(renderToStaticMarkup(<Pill state="healthy">Active</Pill>)).toContain(
      'class="f9-status-pill is-healthy"',
    );
    expect(renderToStaticMarkup(<Pill variant="longevity">Running 12 days</Pill>)).toContain(
      'class="f9-longevity-pill"',
    );
  });
});
