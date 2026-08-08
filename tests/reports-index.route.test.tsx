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
        lastScannedAt: "2026-07-16T06:00:00.000Z",
      },
      {
        id: "watch-2",
        name: "Never Scanned Co",
        targetLabel: "neverscanned.com",
        isActive: true,
        // A record rename must never outrank real evidence time, and a
        // never-checked watchlist must not claim a time at all.
        updatedAt: "2026-07-18T08:00:00.000Z",
        lastScannedAt: null,
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
          timeLabel: "Checked",
          timeAt: "2026-07-16T06:00:00.000Z",
        },
        {
          id: "collection:collection-1",
          href: "/app/reports/collection%3Acollection-1",
          title: "Offer tests",
          timeLabel: "Edited",
          timeAt: "2026-07-15T08:00:00.000Z",
        },
        {
          id: "watchlist:watch-2",
          title: "Never Scanned Co",
          description: "No check has run yet · neverscanned.com",
          timeLabel: null,
          timeAt: null,
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

  it("renders report sources as quiet ruled rows with one filled header action", async () => {
    await installIndexMocks({
      accessDenied: false,
      reports: [
        {
          id: "collection:collection-1",
          href: "/app/reports/collection%3Acollection-1",
          typeLabel: "Collection report",
          title: "Offer tests",
          description: "Claims worth reviewing",
          timeLabel: "Edited",
          timeAt: "2026-07-15T08:00:00.000Z",
        },
      ],
    });
    const { ReportsIndexRoute } = await import("~/routes/app.reports.index.ui");
    const markup = renderToStaticMarkup(createElement(ReportsIndexRoute));

    expect(markup).toContain(">Reports</h1>");
    expect(markup).toContain("Offer tests");
    expect(markup).toContain('href="/app/reports/collection%3Acollection-1"');

    expect(markup).toContain(">Available reports</h2>");
    expect(markup).toContain('aria-label="Available reports"');
    expect(markup).toContain('role="list"');
    expect(markup).toContain("f9-wk-rows");
    expect(markup.match(/class="[^"]*\bf9-wk-row\b[^"]*"/g) ?? []).toHaveLength(1);
    expect(markup.match(/role="listitem"/g) ?? []).toHaveLength(1);
    expect(markup).not.toContain("f9-evidence-report-shelf");
    expect(markup).not.toContain("f9-evidence-report-band");
    expect(markup).not.toContain("f9-work-row");
    expect(markup).not.toContain("Open report");

    expect(markup).toContain("Open the latest report");
    expect(markup.match(/f9-wk-btn/g) ?? []).toHaveLength(1);
    expect(markup).toContain('href="/app/shares"');
    expect(markup).toContain("Manage shared links");
    expect(markup).toContain("f9-wk-lnk");
    expect(markup).not.toContain("f9-primary-button");
    expect(markup).not.toContain("f9-secondary-button");
  });

  it("renders an explanation and two real paths without specimen theater when empty", async () => {
    await installIndexMocks({ accessDenied: false, reports: [] });
    const { ReportsIndexRoute } = await import("~/routes/app.reports.index.ui");
    const markup = renderToStaticMarkup(createElement(ReportsIndexRoute));

    expect(markup).toContain("No report source yet");
    expect(markup).toContain("Open collections");
    expect(markup).toContain("Open competitors");
    expect(markup).not.toContain("f9-evidence-specimen");
    expect(markup).not.toContain("f9-evidence-specimen-slot");
    expect(markup.match(/f9-wk-btn/g) ?? []).toHaveLength(1);
    expect(markup).not.toContain("Open the latest report");
  });

  it("renders the Starter gate as a quiet explanation with one upgrade action", async () => {
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
    expect(markup).toContain("Your workspace evidence is not used as an upgrade preview.");
    expect(markup).not.toContain("f9-evidence-specimen-slot");
    expect(markup).not.toContain("Sample · not your workspace");
    expect(markup).not.toContain("What an Agency report looks like");
    expect(markup.match(/f9-wk-btn/g) ?? []).toHaveLength(1);
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
    DashboardPage: ({ children, className }: MockProps) => (
      <main className={typeof className === "string" ? className : undefined}>{children}</main>
    ),
  }));
}
