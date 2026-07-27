import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockProps = { children?: ReactNode } & Record<string, unknown>;

const listCollections = vi.fn();
const listWatchlists = vi.fn();
const requireWorkspacePlanFeature = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doMock("~/lib/auth.server", () => ({
    requireWorkspaceSession: vi.fn().mockResolvedValue({ workspaceUserId: "workspace-owner" }),
  }));
  vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn().mockReturnValue({ DB: {} }) }));
  vi.doMock("~/lib/data.server", () => ({ listCollections, listWatchlists }));
  vi.doMock("~/lib/plan-feature-gate.server", () => ({ requireWorkspacePlanFeature }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("reports index", () => {
  it("lists owner-scoped collection and competitor reports newest first", async () => {
    requireWorkspacePlanFeature.mockResolvedValue({ ok: true, plan: "agency" });
    listCollections.mockResolvedValue([
      {
        id: "collection-1",
        name: "Offer tests",
        description: "Claims worth reviewing",
        updatedAt: "2026-07-15T08:00:00.000Z",
      },
    ]);
    listWatchlists.mockResolvedValue([
      {
        id: "watch-1",
        name: "Nykaa",
        targetLabel: "nykaa.com",
        isActive: true,
        updatedAt: "2026-07-16T08:00:00.000Z",
      },
    ]);

    const { loader } = await import("~/routes/app.reports.index");
    const data = await loader({
      context: {},
      params: {},
      request: new Request("https://0509.io/app/reports"),
    } as never);

    expect(requireWorkspacePlanFeature).toHaveBeenCalledWith(
      expect.anything(),
      "workspace-owner",
      "client_reports",
    );
    expect(listCollections).toHaveBeenCalledWith(expect.anything(), "workspace-owner");
    expect(listWatchlists).toHaveBeenCalledWith(expect.anything(), "workspace-owner", {
      includeInactive: true,
    });
    expect(data).toMatchObject({
      accessDenied: false,
      reports: [
        {
          id: "watchlist:watch-1",
          href: "/app/reports/watchlist%3Awatch-1",
          title: "Nykaa",
        },
        {
          id: "collection:collection-1",
          href: "/app/reports/collection%3Acollection-1",
          title: "Offer tests",
        },
      ],
    });
  });

  it("returns a pre-click Agency boundary without reading report sources", async () => {
    requireWorkspacePlanFeature.mockResolvedValue({ ok: false, plan: "starter" });
    const { loader } = await import("~/routes/app.reports.index");
    const data = await loader({
      context: {},
      params: {},
      request: new Request("https://0509.io/app/reports"),
    } as never);

    expect(data).toEqual({
      accessDenied: true,
      feature: "client_reports",
      plan: "starter",
      reports: [],
      upgradePath: "/app/billing?source=reports#plans",
    });
    expect(listCollections).not.toHaveBeenCalled();
    expect(listWatchlists).not.toHaveBeenCalled();
  });

  it("renders report artifacts as bands, one Rank-1, and an honestly separate shared-link action", async () => {
    await installIndexMocks({
      accessDenied: false,
      reports: [
        {
          id: "collection:collection-1",
          href: "/app/reports/collection%3Acollection-1",
          typeLabel: "Collection report",
          title: "Offer tests",
          description: "Claims worth reviewing",
          updatedAt: "2026-07-15T08:00:00.000Z",
        },
      ],
    });
    const { ReportsIndexRoute } = await import("~/routes/app.reports.index.ui");
    const markup = renderToStaticMarkup(createElement(ReportsIndexRoute));

    expect(markup).toContain("<h1>Reports</h1>");
    expect(markup).toContain("Offer tests");
    expect(markup).toContain('href="/app/reports/collection%3Acollection-1"');
    expect(markup).toContain("Open report");

    // Brief §6.1: one full-width band per source, never a card grid, so a
    // 3+1 orphan hole cannot form.
    expect(markup).toContain("f9-ed-report-shelf");
    expect(markup).toContain("f9-ed-report-band");
    expect(markup).not.toContain("f9-work-row");

    // Brief §5 + DESIGN.md WP-A3: the header's Rank-1 is the thing this page
    // exists to do, and cross-navigation to /app/shares drops to Rank 3.
    expect(markup).toContain("Open the latest report");
    expect(markup.match(/f9-ed-cta--rank1/g) ?? []).toHaveLength(1);
    expect(markup).toContain('href="/app/shares"');
    expect(markup).toContain("Manage shared links");
    expect(markup).toContain("f9-ed-cta--rank3");
    expect(markup).not.toContain("f9-primary-button");
    expect(markup).not.toContain("f9-secondary-button");
  });

  it("renders a designed specimen instead of an empty box when there is no report source", async () => {
    await installIndexMocks({ accessDenied: false, reports: [] });
    const { ReportsIndexRoute } = await import("~/routes/app.reports.index.ui");
    const markup = renderToStaticMarkup(createElement(ReportsIndexRoute));

    expect(markup).toContain("f9-ed-specimen");
    expect(markup).toContain("No report source yet");
    expect(markup).toContain("f9-ed-specimen-slot");
    expect(markup).toContain("Open collections");
    expect(markup).toContain("Open competitors");
    // No header Rank-1 while there is nothing to open: the specimen carries
    // the page's single primary.
    expect(markup.match(/f9-ed-cta--rank1/g) ?? []).toHaveLength(1);
    expect(markup).not.toContain("Open the latest report");
  });

  it("renders the Starter gate as a designed LockedFeature with a sample specimen", async () => {
    await installIndexMocks({
      accessDenied: true,
      feature: "client_reports",
      plan: "starter",
      upgradePath: "/app/billing?source=reports#plans",
      reports: [],
    });
    const { ReportsIndexRoute } = await import("~/routes/app.reports.index.ui");
    const markup = renderToStaticMarkup(createElement(ReportsIndexRoute));

    expect(markup).toContain("f9-locked-feature");
    expect(markup).toContain("Client-ready reports");
    expect(markup).toContain(
      "Open client-ready reports and share the evidence with your team — included in the Agency plan.",
    );
    expect(markup).toContain('href="/app/billing?source=reports#plans"');
    expect(markup).toContain("Upgrade to Agency");
    // Brief §6.8: a dimmed, labelled SAMPLE, never a redacted preview of the
    // workspace's own evidence and never a 1,000px void.
    expect(markup).toContain("f9-ed-specimen-slot");
    expect(markup).toContain("Sample · not your workspace");
    expect(markup).toContain("What an Agency report looks like");
    expect(markup.match(/f9-ed-cta--rank1/g) ?? []).toHaveLength(1);
  });
});

async function installIndexMocks(loaderData: unknown) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Link: ({ children, to, ...props }: MockProps & { to?: string }) =>
        React.createElement("a", { ...props, href: to }, children),
      useLoaderData: vi.fn().mockReturnValue(loaderData),
    };
  });
  vi.doMock("~/components/dashboard-page", () => ({
    DashboardPage: ({ children }: MockProps) => children,
    DashboardPageHeader: ({
      action,
      lead,
      title,
    }: {
      action?: { label: string; to: string };
      lead: string;
      title: string;
    }) => (
      <header>
        <h1>{title}</h1>
        <p>{lead}</p>
        {action ? (
          <a className="f9-ed-cta f9-ed-cta--rank1" href={action.to}>
            {action.label}
          </a>
        ) : null}
      </header>
    ),
  }));
}
