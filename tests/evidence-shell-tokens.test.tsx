import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { Pill } from "~/components/pill";

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
    expect(markup).toContain('data-ed-volume="workspace"');
  });

  it("stamps the plain volume for long-dwell settings surfaces", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage volume="plain" className="f9-account">
        <p>Body</p>
      </DashboardPage>,
    );

    expect(markup).toContain('class="f9-dash-content f9-account"');
    expect(markup).toContain('data-ed-volume="plain"');
  });
});

describe("DashboardPageHeader", () => {
  it("renders the action slot as the page's one Rank-1 action", () => {
    const markup = renderRouted(
      <DashboardPageHeader
        kicker="Competitors"
        title="Watch board"
        lead="Everything we caught since you last looked."
        action={{ label: "Add competitor", to: "/app/watchlists/new" }}
      />,
    );

    expect(markup.match(/f9-ed-cta--rank1/g)).toHaveLength(1);
    expect(markup).toContain('href="/app/watchlists/new"');
    expect(markup).toContain("Add competitor");
    expect(markup).not.toContain("f9-primary-button");
  });

  it("renders no CTA at all when the page has no primary action", () => {
    const markup = renderToStaticMarkup(<DashboardPageHeader title="Account" />);

    expect(markup).not.toContain("f9-ed-cta");
    expect(markup).toContain("Account");
  });
});

describe("Pill stamp variant", () => {
  it("adds the Evidence Desk state stamp without disturbing the existing families", () => {
    expect(renderToStaticMarkup(<Pill variant="stamp" state="caught">Caught</Pill>)).toContain(
      'class="f9-ed-stamp is-caught"',
    );
    expect(renderToStaticMarkup(<Pill variant="stamp" state="quiet">Quiet</Pill>)).toContain(
      'class="f9-ed-stamp is-quiet"',
    );
    expect(renderToStaticMarkup(<Pill state="healthy">Active</Pill>)).toContain(
      'class="f9-status-pill is-healthy"',
    );
    expect(renderToStaticMarkup(<Pill variant="longevity">Running 12 days</Pill>)).toContain(
      'class="f9-longevity-pill"',
    );
  });
});
