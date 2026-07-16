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

  it("renders report artifacts and an honestly separate shared-link action", async () => {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");
      return {
        ...actual,
        Link: ({ children, to, ...props }: MockProps & { to?: string }) =>
          React.createElement("a", { ...props, href: to }, children),
        useLoaderData: vi.fn().mockReturnValue({
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
        }),
      };
    });
    vi.doMock("~/components/dashboard-page", () => ({
      DashboardPage: ({ children }: MockProps) => children,
      DashboardPageHeader: ({ action, lead, title }: { action: { label: string; to: string }; lead: string; title: string }) => (
        <header>
          <h1>{title}</h1>
          <p>{lead}</p>
          <a href={action.to}>{action.label}</a>
        </header>
      ),
    }));
    const { ReportsIndexRoute } = await import("~/routes/app.reports.index.ui");
    const markup = renderToStaticMarkup(createElement(ReportsIndexRoute));

    expect(markup).toContain("<h1>Reports</h1>");
    expect(markup).toContain("Offer tests");
    expect(markup).toContain('href="/app/reports/collection%3Acollection-1"');
    expect(markup).toContain("Open report");
    expect(markup).toContain('href="/app/shares"');
    expect(markup).toContain("Manage shared links");
  });
});
