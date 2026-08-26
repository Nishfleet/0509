import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { WatchlistRunRecord } from "~/lib/types";
import {
  deliveryTargets,
  discoveryStatus,
  recentCandidates,
  recentDeliveryAttempts,
  recentEvents,
  recentProofCaptures,
  recentRuns,
  setupWatchlistsRouteTestIsolation,
  watchlist,
  watchlistDeliveryConfig,
  workspaceDeliveryConfig,
} from "./helpers/watchlists-route-fixtures";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<
  string,
  unknown
>;

async function mockRouter(overrides: {
  actionData?: unknown;
  fetcher?: {
    state: "idle" | "submitting" | "loading";
    formData?: FormData;
  };
  loaderData?: unknown;
  searchParams?: URLSearchParams;
}) {
  vi.doMock("react-router", async () => {
    const actual =
      await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement(
          "a",
          { ...props, href: typeof to === "string" ? to : "" },
          children,
        ),
      useActionData: vi.fn().mockReturnValue(overrides.actionData),
      // WP-42: pause/resume submits through a fetcher; render it as a plain
      // form in static markup.
      useFetcher: vi.fn().mockReturnValue({
        state: overrides.fetcher?.state ?? "idle",
        data: undefined,
        formData: overrides.fetcher?.formData,
        Form: ({ children, ...props }: MockFormProps) =>
          React.createElement("form", props, children),
      }),
      useLoaderData: vi.fn().mockReturnValue(overrides.loaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      useRevalidator: vi
        .fn()
        .mockReturnValue({ state: "idle", revalidate: vi.fn() }),
      useSearchParams: vi
        .fn()
        .mockReturnValue([
          overrides.searchParams ?? new URLSearchParams("watchlist=watch-1"),
          vi.fn(),
        ]),
    };
  });
}

/**
 * Renders `/app/watchlists` with an opened competitor on `tab`. BL-007 made
 * the detail URL-addressable, so a render helper has to name the tab the way
 * a customer's URL does.
 */
async function renderWatchlistsRoute(
  loaderData: unknown,
  tab?: string,
  fetcher?: { state: "idle" | "submitting" | "loading"; formData?: FormData },
) {
  vi.resetModules();
  await mockRouter({
    actionData: undefined,
    fetcher,
    loaderData,
    searchParams: new URLSearchParams(
      tab ? `watchlist=watch-1&tab=${tab}` : "watchlist=watch-1",
    ),
  });
  const { default: WatchlistsRoute } = await import("~/routes/app.watchlists");
  return renderToStaticMarkup(createElement(WatchlistsRoute));
}

setupWatchlistsRouteTestIsolation();

describe("watchlists route rendering", () => {
  it("derives list-card scan truth from the durable run instead of a missing completion timestamp", async () => {
    const { resolveWatchlistListScanPresentation } = await import("~/routes/app.watchlists");
    const run = (status: WatchlistRunRecord["status"], errorCode: string | null = null) => ({
      ...recentRuns[0],
      errorCode,
      finishedAt: status === "succeeded" ? "2026-04-18T10:01:00.000Z" : null,
      status,
    });

    expect(resolveWatchlistListScanPresentation({
      isActive: true,
      lastScannedAt: null,
      latestRun: null,
      plan: "starter",
    }).label).toBe("No completed check yet — open for status");
    expect(resolveWatchlistListScanPresentation({
      isActive: true,
      lastScannedAt: null,
      latestRun: run("pending", "workflow_binding_missing"),
      plan: "starter",
    }).label).toBe("Check delayed — we're retrying");
    expect(resolveWatchlistListScanPresentation({
      isActive: true,
      lastScannedAt: null,
      latestRun: run("running"),
      plan: "free",
    }).label).toBe("Activation scan running");
    expect(resolveWatchlistListScanPresentation({
      isActive: true,
      lastScannedAt: null,
      latestRun: run("failed", "provider_unavailable"),
      plan: "starter",
    }).label).toBe("Latest check failed — open for next steps");
    expect(resolveWatchlistListScanPresentation({
      isActive: true,
      lastScannedAt: null,
      latestRun: run("skipped", "e2e_provider_network_denied"),
      plan: "starter",
    }).label).toBe("New checks paused — source access needed");
    expect(resolveWatchlistListScanPresentation({
      isActive: true,
      lastScannedAt: null,
      latestRun: run("succeeded"),
      plan: "starter",
    })).toEqual({
      label: "Last successful check",
      timestamp: "2026-04-18T10:01:00.000Z",
    });
  });

  it("keeps empty evidence, recent-check timing, and polling identity bound to the durable run", async () => {
    const {
      firstScanPollingKey,
      resolveEmptyWatchlistEventCopy,
      resolveWatchlistRunCustomerError,
      resolveWatchlistRunTiming,
    } = await import("~/routes/app.watchlists");
    const run = (status: WatchlistRunRecord["status"], errorCode: string | null = null) => ({
      ...recentRuns[0],
      errorCode,
      finishedAt: null,
      id: `run-${status}-${errorCode ?? "none"}`,
      status,
    });
    const copy = (latestRun: WatchlistRunRecord | null) => resolveEmptyWatchlistEventCopy({
      lastScannedAt: null,
      latestRun,
      nextScanLabel: null,
      plan: "free",
    });

    expect(copy(run("running"))).toContain("activation scan is running now");
    expect(copy(run("pending"))).toContain("activation scan is in line");
    expect(copy(run("pending", "workflow_binding_missing"))).toContain("retrying it automatically");
    expect(copy(run("failed", "provider_unavailable"))).toContain("couldn't finish");
    expect(copy(run("skipped", "e2e_provider_network_denied"))).toContain("paused safely");
    expect(copy(run("succeeded"))).toContain("activation scan is complete");
    expect(copy(run("succeeded"))).toContain("checked weekly");
    for (const state of [
      null,
      run("pending"),
      run("pending", "workflow_binding_missing"),
      run("failed"),
      run("skipped"),
      run("succeeded"),
    ]) {
      expect(copy(state)).not.toContain("running now");
    }
    for (const state of [
      run("pending"),
      run("running"),
      run("failed"),
      run("skipped"),
    ]) {
      expect(resolveEmptyWatchlistEventCopy({
        lastScannedAt: "2026-04-17T10:00:00.000Z",
        latestRun: state,
        nextScanLabel: "tomorrow",
        plan: "free",
      })).not.toContain("activation-only scan is complete");
    }
    for (const state of [
      null,
      run("failed"),
      run("skipped", "e2e_provider_network_denied"),
    ]) {
      const recoveryCopy = copy(state);
      expect(recoveryCopy).not.toMatch(/\bretry\b/i);
      expect(recoveryCopy).toContain("support");
    }

    expect(resolveWatchlistRunTiming(run("pending"))).toEqual({
      label: "In line — starts automatically",
      timestamp: null,
    });
    expect(resolveWatchlistRunTiming(run("pending", "dispatch_failed")).label).toBe("Retrying automatically");
    expect(resolveWatchlistRunTiming(run("running")).label).toBe("Still running");
    expect(resolveWatchlistRunTiming(run("failed")).label).toBe("Stopped after a failed check");
    expect(resolveWatchlistRunTiming(run("skipped")).label).toBe("Stopped before results were saved");

    const failedWithPrivateError = {
      ...run("failed"),
      errorMessage: "provider token leaked",
    };
    expect(resolveWatchlistRunCustomerError(failedWithPrivateError, "free")).toBe(
      "This activation scan failed. Check Source access, and email support if the next attempt fails too.",
    );
    expect(resolveWatchlistRunCustomerError(failedWithPrivateError, "free")).not.toMatch(/\bretry\b/i);
    expect(resolveWatchlistRunCustomerError(failedWithPrivateError, "starter")).toBe(
      "This scan failed. Check Source access, then retry — or email support and we'll dig in.",
    );
    expect(resolveWatchlistRunCustomerError(failedWithPrivateError, "free")).not.toContain(
      "provider token leaked",
    );

    const pending = run("pending");
    expect(firstScanPollingKey({ watchlistId: "watch-1", run: pending })).not.toBe(
      firstScanPollingKey({ watchlistId: "watch-1", run: { ...pending, id: "retry-run" } }),
    );
    expect(firstScanPollingKey({ watchlistId: "watch-1", run: pending })).not.toBe(
      firstScanPollingKey({ watchlistId: "watch-1", run: { ...pending, status: "running" } }),
    );
  });

  it("keeps saved evidence visible without promising a recurring check when source access is unavailable", async () => {
    const { resolveWatchlistTrackingPresentation } = await import("~/routes/app.watchlists");
    const presentation = resolveWatchlistTrackingPresentation(
      {
        status: "demo",
        summary: "Live ad checks aren't configured yet, so searches show labeled sample data.",
        lastCheckedAt: null,
        recovery: null,
      },
      recentRuns,
      {
        totalAttempts: 1,
        successfulAttempts: 1,
        failedAttempts: 0,
        skippedAttempts: 0,
        skippedDueToBudget: 0,
        skippedDueToRateLimit: 0,
        skippedDueToDedupe: 0,
        lastAttemptAt: "2026-04-18T09:59:50.000Z",
        lastSuccessfulProofAt: "2026-04-18T09:59:50.000Z",
      },
    );

    expect(presentation).toEqual({
      headline: "Monitoring history is saved; new checks need source access",
      summary: "Your last successful evidence remains available. Review source access before relying on new competitor changes.",
      statusLabel: "Needs source access",
      lastCheckedAt: "2026-04-18T10:01:00.000Z",
    });
  });

  // BL-006 — brief §6.1/§6.3/§7: the board is the page.
  it("renders the watch board with one band per competitor and no detail panel", async () => {
    await mockRouter({
      actionData: undefined,
      searchParams: new URLSearchParams(),
      loaderData: {
        renderedAt: "2026-04-18T10:59:50.000Z",
        plan: "starter",
        canManageDelivery: true,
        verifiedAccountEmail: "owner@example.com",
        watchlists: [watchlist, { ...watchlist, id: "watch-2", name: "Paused rival", isActive: false }],
        selectedWatchlist: null,
        captureWindow: {
          endDate: "2026-04-18",
          windowDays: 30,
          days: {
            "watch-1": [
              { date: "2026-04-17", state: "quiet" },
              { date: "2026-04-18", state: "captured" },
            ],
          },
          capturedChanges: { "watch-1": 2 },
          totalCapturedChanges: 2,
          failedChecks: {},
        },
        captureWindowDegraded: true,
        eventCandidates: [],
        events: [],
        runs: [],
        workspaceDeliveryConfig,
        watchlistDeliveryConfig: null,
        discoveryStatus,
        effectiveDeliveryConfig: {
          sensitivityMode: "balanced",
          instantEnabled: false,
          digestEnabled: true,
          digestCadencePreference: "plan_default",
          emailEnabled: true,
          whatsappEnabled: false,
          slackEnabled: false,
          quietHours: null,
          timezone: "UTC",
        },
        deliveryTargets: [],
        workspaceDeliveryTargets: [],
        recentDeliveryAttempts: [],
        recentProofCaptures: [],
        proofSummary: {
          totalAttempts: 0,
          successfulAttempts: 0,
          failedAttempts: 0,
          skippedAttempts: 0,
          skippedDueToBudget: 0,
          skippedDueToRateLimit: 0,
          skippedDueToDedupe: 0,
          lastAttemptAt: null,
          lastSuccessfulProofAt: null,
        },
        creativeWall: [],
        trendDailyActivity: [],
      },
    });

    const { default: WatchlistsRoute } = await import("~/routes/app.watchlists");
    const markup = renderToStaticMarkup(createElement(WatchlistsRoute));

    // BL-030 — the list is a list: one ruled row per competitor, each with a
    // name, one plain sentence, one status word and one date. The band, its
    // 30-day histogram, the ticker and the five-cell status strip are gone;
    // the same facts are one line of text or one row of the detail pane.
    expect(markup.match(/class="f9-wk-row(?: [^"]*)?"/g)).toHaveLength(2);
    expect(markup).toContain("Nykaa watch");
    expect(markup).toContain("Paused rival");
    expect(markup).toContain("Recent change and failed-check totals could not be loaded.");
    expect(markup).toContain("Recent change and failed-check totals are unavailable.");
    expect(markup).toContain("Recent totals are unavailable.");
    expect(markup).not.toContain("2 changes captured in the last 30 days.");
    expect(markup).not.toContain("Checked, and nothing has changed");
    expect(markup).not.toContain("competitor-detail");
    expect(markup).toContain("Paused. No checks run and the history stays.");
    expect(markup).not.toContain("f9-evidence-capture-strip");
    expect(markup).not.toContain("f9-evidence-ticker");
    expect(markup).not.toContain("f9-evidence-status-strip");
    // Exactly one filled button — the page's single action.
    expect(markup.match(/class="f9-wk-btn"/g)).toHaveLength(1);
    expect(markup).toContain("Add competitor");
    expect(markup).not.toContain("f9-evidence-cta--rank1");
    // Q5: bulk import is one click from the board (expand the details).
    expect(markup).toContain("Add several competitors by paste or CSV");
    expect(markup).toContain('name="importSurface"');
    expect(markup).toContain('value="watchlists"');
    expect(markup).toContain('name="competitors"');
    expect(markup).toContain('name="competitorFile"');
    expect(markup).toContain('value="preview-market-desk-import"');
    // Aggregate-derived state filters stand down while their rollup is unavailable.
    expect(markup).not.toContain('class="f9-wk-tab');
    // The detail pane and the full record stay closed until a row is opened.
    expect(markup).not.toContain("f9-wk-detail");
    expect(markup).not.toContain("Evidence and alerts");
    expect(markup).not.toContain("Watchlist setup");
    // No bulk bar without a selection.
    expect(markup).not.toContain("competitors selected");
  });

  it("renders the designed specimen panel when nothing is tracked yet", async () => {
    await mockRouter({
      actionData: undefined,
      searchParams: new URLSearchParams(),
      loaderData: {
        renderedAt: "2026-04-18T10:59:50.000Z",
        plan: "free",
        canManageDelivery: true,
        verifiedAccountEmail: null,
        watchlists: [],
        selectedWatchlist: null,
        captureWindow: {
          endDate: "2026-04-18",
          windowDays: 30,
          days: {},
          capturedChanges: {},
          totalCapturedChanges: 0,
          failedChecks: {},
        },
        eventCandidates: [],
        events: [],
        runs: [],
        workspaceDeliveryConfig,
        watchlistDeliveryConfig: null,
        discoveryStatus,
        effectiveDeliveryConfig: {
          sensitivityMode: "balanced",
          instantEnabled: false,
          digestEnabled: true,
          digestCadencePreference: "plan_default",
          emailEnabled: true,
          whatsappEnabled: false,
          slackEnabled: false,
          quietHours: null,
          timezone: "UTC",
        },
        deliveryTargets: [],
        workspaceDeliveryTargets: [],
        recentDeliveryAttempts: [],
        recentProofCaptures: [],
        proofSummary: {
          totalAttempts: 0,
          successfulAttempts: 0,
          failedAttempts: 0,
          skippedAttempts: 0,
          skippedDueToBudget: 0,
          skippedDueToRateLimit: 0,
          skippedDueToDedupe: 0,
          lastAttemptAt: null,
          lastSuccessfulProofAt: null,
        },
        creativeWall: [],
        trendDailyActivity: [],
      },
    });

    const { default: WatchlistsRoute } = await import("~/routes/app.watchlists");
    const markup = renderToStaticMarkup(createElement(WatchlistsRoute));

    // BL-030 round 2: an empty board gets a sentence and a way in, not a
    // dimmed specimen plate. The caps-mono "BAND 01 — RESERVED" diagram of the
    // thing the customer does not have yet was the v3 ornament habit.
    expect(markup).not.toContain("f9-evidence-specimen");
    expect(markup).not.toContain("BAND 01 — RESERVED");
    expect(markup).not.toContain("WATCH BOARD · NOTHING TRACKED YET");
    expect(markup).toContain("Nothing tracked yet");
    expect(markup).toContain(
      "Add your first competitor and its first check starts immediately.",
    );
    expect(markup).toContain("See a proof brief");
    expect(markup).toContain("Add several competitors by paste or CSV");
    expect(markup).toContain('name="competitors"');
    expect(markup).toContain('value="preview-market-desk-import"');
    // The screen still carries exactly one filled button, and it is the
    // header's — the one thing this page exists to do.
    expect(markup).not.toContain("f9-evidence-cta--rank1");
    expect(markup.match(/class="f9-wk-btn"/g)).toHaveLength(1);
    // No board chrome without competitors.
    expect(markup).not.toContain("f9-wk-tabs");
    expect(markup).not.toContain("f9-evidence-ticker");
    expect(markup).not.toContain("f9-evidence-status-strip");
  });

  const selectedPanelLoaderData = {
    renderedAt: "2026-04-18T10:59:50.000Z",
    plan: "starter",
    canManageDelivery: false,
    verifiedAccountEmail: "member@example.com",
    watchlists: [watchlist],
    selectedWatchlist: watchlist,
    eventCandidates: recentCandidates,
    events: recentEvents,
    runs: recentRuns,
    workspaceDeliveryConfig,
    watchlistDeliveryConfig,
    discoveryStatus,
    effectiveDeliveryConfig: {
      sensitivityMode: "quiet",
      instantEnabled: true,
      digestEnabled: true,
      digestCadencePreference: "plan_default",
      emailEnabled: true,
      whatsappEnabled: true,
      slackEnabled: false,
      quietHours: {
        startHour: 22,
        endHour: 8,
      },
      timezone: "Asia/Kolkata",
    },
    deliveryTargets,
    workspaceDeliveryTargets: [],
    recentDeliveryAttempts,
    recentProofCaptures,
    proofSummary: {
      totalAttempts: 2,
      successfulAttempts: 2,
      failedAttempts: 0,
      skippedAttempts: 0,
      skippedDueToBudget: 0,
      skippedDueToRateLimit: 0,
      skippedDueToDedupe: 0,
      lastAttemptAt: "2026-04-18T09:59:50.000Z",
      lastSuccessfulProofAt: "2026-04-18T09:59:50.000Z",
    },
    creativeWall: [],
    trendDailyActivity: [],
  };

  it("renders a selected competitor as one entity-owned detail surface", async () => {
    const markup = await renderWatchlistsRoute(selectedPanelLoaderData);

    expect(markup).toContain('<h1 class="f9-wk-title">Nykaa watch</h1>');
    expect(markup).toContain('href="/app/watchlists">All competitors</a>');
    // Detail stays a record. Bulk import lives on the board: All competitors
    // (click 1) then expand the paste/CSV details (click 2).
    expect(markup).not.toContain("Add several competitors by paste or CSV");
    expect(markup.match(/id="competitor-detail"/g)).toHaveLength(1);
    expect(markup).not.toContain('aria-label="Competitors"');
    // BL-035 keeps a split INSIDE the detail (panel + fact rail). What must be
    // gone is the board's list/peek split that used to sit under it.
    expect(markup).not.toContain('class="f9-wk-split is-single"');
    expect(markup).not.toContain('class="f9-wk-split-list"');
    expect(markup).toContain('class="f9-wk-split is-wide f9-watchdetail-split"');
  });

  it("does not turn a failed capture-window rollup into a quiet or zero finding", async () => {
    const markup = await renderWatchlistsRoute({
      ...selectedPanelLoaderData,
      captureWindowDegraded: true,
    });

    expect(markup).toContain("Recent aggregate totals are unavailable");
    expect(markup).toContain("Unavailable — refresh to try again");
    expect(markup).not.toContain("Checked, and nothing has changed in 30 days.");
    expect(markup).not.toContain('class="f9-evidence-number-value">0</p>');
    // The status strip is gone in BL-035, so the same statement is carried by
    // the working header's context line and the caught number card.
    expect(markup).toContain("Recent totals unavailable");
    expect(markup).toContain('class="f9-evidence-number-value">Unavailable</p>');
  });

  it("does not promise automatic checks while source access is blocked", async () => {
    const markup = await renderWatchlistsRoute(
      {
        ...selectedPanelLoaderData,
        discoveryStatus: {
          status: "demo",
          provider: "meta_library_browser",
          mode: "demo",
          summary: "Live source access is unavailable.",
          lastCheckedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      },
      "setup",
    );

    expect(markup).toContain("Automatic checks are waiting for source access");
    expect(markup).not.toContain("Automatic checks are on.");
    expect(markup).toContain('href="/app/source-access"');
  });

  it("keeps action feedback text from becoming an external navigation sink", async () => {
    await mockRouter({
      actionData: { ok: true, message: "http://evil.example/phish" },
      loaderData: selectedPanelLoaderData,
      searchParams: new URLSearchParams("watchlist=watch-1"),
    });
    const { default: WatchlistsRoute } = await import("~/routes/app.watchlists");
    const markup = renderToStaticMarkup(createElement(WatchlistsRoute));

    expect(markup).toContain("http://evil.example/phish");
    expect(markup).not.toContain('href="http://evil.example/phish"');
    expect(markup).not.toContain('target="_blank"');
  });

  it("escapes watchlist and event text as markup-safe customer content", async () => {
    const hostileWatchlist = {
      ...watchlist,
      name: '<img src=x onerror="alert(1)">',
      targetLabel: "<script>alert(2)</script>",
    };
    const markup = await renderWatchlistsRoute({
      ...selectedPanelLoaderData,
      watchlists: [hostileWatchlist],
      selectedWatchlist: hostileWatchlist,
      events: recentEvents.map((event) => ({
        ...event,
        summary: "<b>untrusted event</b>",
      })),
    });

    expect(markup).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(markup).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
    expect(markup).toContain("&lt;b&gt;untrusted event&lt;/b&gt;");
    expect(markup).not.toContain("<img src=x");
    expect(markup).not.toContain("<script>alert(2)</script>");
  });

  // BL-007 (brief §6.4): the opened competitor is five URL-addressable
  // surfaces, not one scroll. Each assertion below now names the tab the
  // customer has to be on to see it.
  it("opens the competitor on the change feed with the tab bar and the fact rail", async () => {
    const markup = await renderWatchlistsRoute(selectedPanelLoaderData);

    // BL-035: `?watchlist=` is its own working surface. The old board + peek
    // + below-board BL-007 record stack is gone; the entity owns the header,
    // tabs follow immediately, and there is one content split.
    expect(markup).toContain("<h1 class=\"f9-wk-title\">Nykaa watch</h1>");
    expect(markup).toContain("All competitors");
    expect(markup).toContain('class="f9-watchdetail-detail"');
    expect(markup).not.toContain('aria-label="Competitors"');
    expect(markup).not.toContain("f9-wk-detail");
    expect(markup).not.toContain("f9-wk-record");
    expect(markup).not.toContain("f9-evidence-detail-head");
    expect(markup).not.toContain("f9-evidence-status-strip");

    // The tab bar is real navigation: five links, fixed order, the active one
    // marked with aria-current and not by ink alone (brief §10).
    expect(markup).toContain('aria-label="Competitor sections"');
    for (const [label, href] of [
      ["What changed", "/app/watchlists?watchlist=watch-1"],
      ["Evidence", "/app/watchlists?watchlist=watch-1&amp;tab=evidence"],
      ["Creative", "/app/watchlists?watchlist=watch-1&amp;tab=creative"],
      ["Delivery", "/app/watchlists?watchlist=watch-1&amp;tab=delivery"],
      ["Setup", "/app/watchlists?watchlist=watch-1&amp;tab=setup"],
    ]) {
      expect(markup).toContain(`href="${href}"`);
      expect(markup).toContain(label);
    }
    expect(markup).toMatch(
      /<a(?=[^>]*aria-current="page")(?=[^>]*class="f9-wk-tab is-on")(?=[^>]*href="\/app\/watchlists\?watchlist=watch-1")[^>]*><span>What changed<\/span><\/a>/,
    );

    // The change feed is the default panel.
    expect(markup).toContain("What changed");
    expect(markup).toContain("f9-evidence-diff-plate");
    expect(markup).toContain("High confidence");
    expect(markup).toContain("This is the stored capture, not a re-render.");
    expect(markup).toContain("Starting at ₹499");
    expect(markup).toContain("Starting at ₹799");
    expect(markup).not.toContain("Insight depth");
    expect(markup).not.toContain("Meta ads tracking beta");

    // The rail is exactly three objects (brief §7): number card, fact rail,
    // delivery card — and nothing from the other tabs leaks onto this one.
    expect(markup).toContain("f9-evidence-number-card");
    expect(markup).toContain("f9-evidence-fact-rail");
    expect(markup).toContain("Who gets told");
    expect(markup).toContain("Watching");
    expect(markup).not.toContain("Save watchlist");
    expect(markup).not.toContain("Recent evidence checks");
    expect(markup).not.toContain("Recent proof captures");
  });

  it("keeps Package for client available for a quiet completed Agency check", async () => {
    const markup = await renderWatchlistsRoute({
      ...selectedPanelLoaderData,
      plan: "agency",
      events: [],
    });

    expect(markup).toContain("Package for client");
    expect(markup).toContain(
      'href="/app/reports/watchlist:watch-1"',
    );
  });

  it.each([
    {
      plan: "free",
      share: false,
      export: false,
      report: false,
      primary: "Upgrade plan",
    },
    {
      plan: "scout",
      share: false,
      export: false,
      report: false,
      primary: "Upgrade plan",
    },
    {
      plan: "starter",
      share: true,
      export: true,
      report: false,
      primary: "Upgrade plan",
    },
    {
      plan: "agency",
      share: true,
      export: true,
      report: true,
      primary: "Refresh now",
    },
  ])(
    "re-proves the completed active $plan action contract",
    async ({ plan, share, export: canExport, report, primary }) => {
      const markup = await renderWatchlistsRoute(
        { ...selectedPanelLoaderData, plan },
        "evidence",
      );

      expect(markup.match(/class="f9-wk-btn"/g)).toHaveLength(1);
      expect(markup).toContain(`>${primary}</`);
      expect(markup.includes("Share summary")).toBe(share);
      expect(markup.includes("Export CSV")).toBe(canExport);
      expect(markup.includes("Export JSON")).toBe(canExport);
      expect(markup.includes("Package for client")).toBe(report);
      expect(markup).not.toContain("f9-evidence-detail-head");
      expect(markup).not.toContain("f9-evidence-status-strip");
    },
  );

  it.each([
    { plan: "free", hasLockedCapabilities: true },
    { plan: "scout", hasLockedCapabilities: true },
    { plan: "starter", hasLockedCapabilities: true },
    { plan: "agency", hasLockedCapabilities: false },
  ])(
    "makes resume the one Rank-1 action for a paused $plan competitor",
    async ({ plan, hasLockedCapabilities }) => {
      const paused = { ...watchlist, isActive: false };
      const markup = await renderWatchlistsRoute(
        {
          ...selectedPanelLoaderData,
          plan,
          watchlists: [paused],
          selectedWatchlist: paused,
        },
        "setup",
      );

      expect(markup.match(/class="f9-wk-btn"/g)).toHaveLength(1);
      expect(markup).toContain(">Resume watching</button>");
      expect(markup).toContain(
        "Watching is paused. The evidence already on file stays here.",
      );
      expect(markup.includes(">Upgrade plan</a>")).toBe(hasLockedCapabilities);
      expect(markup).not.toContain(">Refresh now</button>");
    },
  );

  it("keeps manual refresh for an active Agency competitor before its first successful scan", async () => {
    const firstScanWatchlist = { ...watchlist, lastScannedAt: null };
    const markup = await renderWatchlistsRoute(
      {
        ...selectedPanelLoaderData,
        plan: "agency",
        watchlists: [firstScanWatchlist],
        selectedWatchlist: firstScanWatchlist,
      },
    );

    expect(markup.match(/>Refresh now<\/button>/g)).toHaveLength(1);
    expect(markup).not.toContain(">Upgrade plan</a>");
  });

  it("shows the fetcher-backed resume pending state in the working header", async () => {
    const paused = { ...watchlist, isActive: false };
    const formData = new FormData();
    formData.set("intent", "resume-watchlist");
    formData.set("watchlistId", paused.id);
    const markup = await renderWatchlistsRoute(
      {
        ...selectedPanelLoaderData,
        plan: "agency",
        watchlists: [paused],
        selectedWatchlist: paused,
      },
      "setup",
      { state: "submitting", formData },
    );

    expect(markup).toMatch(
      /<button(?=[^>]*aria-busy="true")(?=[^>]*disabled)[^>]*>[\s\S]*?Resuming…<\/button>/,
    );
  });

  it("keeps repeated failures as page state and points to the Evidence section", async () => {
    const failedRuns = Array.from({ length: 3 }, (_, index) => ({
      ...recentRuns[0],
      id: `failed-${index}`,
      status: "failed" as const,
      finishedAt: `2026-04-18T0${8 - index}:01:00.000Z`,
      errorCode: "source_timeout",
      errorMessage: "private provider detail",
    }));
    const markup = await renderWatchlistsRoute({
      ...selectedPanelLoaderData,
      runs: failedRuns,
      captureWindow: {
        endDate: "2026-04-18",
        windowDays: 30,
        days: {},
        capturedChanges: {},
        totalCapturedChanges: 0,
        failedChecks: { "watch-1": 3 },
      },
    });

    expect(markup).toContain("the last 3 checks failed");
    expect(markup).toContain("recent errors are listed under Evidence");
    expect(markup).not.toContain("private provider detail");
  });

  it("keeps the entity detail coherent if the parallel board list misses its selected row", async () => {
    const markup = await renderWatchlistsRoute({
      ...selectedPanelLoaderData,
      watchlists: [],
    });

    expect(markup).toContain("<h1 class=\"f9-wk-title\">Nykaa watch</h1>");
    expect(markup).toContain("All competitors");
    expect(markup).toContain('aria-label="Competitor sections"');
    expect(markup).toContain('class="f9-watchdetail-detail"');
    expect(markup).not.toContain('aria-label="Competitors"');
  });

  it("keeps blocked source access actionable in the compressed working header", async () => {
    const markup = await renderWatchlistsRoute(
      {
        ...selectedPanelLoaderData,
        discoveryStatus: {
          status: "demo",
          provider: "meta_library_browser",
          mode: "demo",
          summary: "Live source access is unavailable.",
          lastCheckedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      },
      "setup",
    );

    expect(markup).toContain('href="/app/source-access"');
    expect(markup).toContain("Needs source access");
    expect(markup).toContain(
      "Automatic checks are waiting for source access. The evidence already on file stays here.",
    );
    expect(markup).not.toContain("Automatic checks are on.");
    expect(markup.indexOf("Needs source access")).toBeLessThan(
      markup.indexOf('aria-label="Competitor sections"'),
    );
  });

  // Reconciled with BL-035: every honesty assertion from main's degraded test
  // is kept; the control assertions follow the controls to the tab that now
  // owns them (pause -> Setup, share/export -> Evidence).
  it("keeps the selected overview honest when recent capture totals are unavailable", async () => {
    const failedRuns = Array.from({ length: 3 }, (_, index) => ({
      ...recentRuns[0],
      id: `failed-run-${index + 1}`,
      status: "failed" as const,
      errorCode: "provider_unavailable",
      errorMessage: "Provider unavailable.",
    }));
    const degraded = {
      ...selectedPanelLoaderData,
      plan: "agency",
      captureWindowDegraded: true,
      runs: failedRuns,
    };
    const markup = await renderWatchlistsRoute(degraded);

    expect(markup).toContain("Nykaa watch");
    expect(markup).toContain("Unavailable — refresh to try again");
    expect(markup).toContain("Recent aggregate totals are unavailable");
    expect(markup).toContain("is-capture-window-degraded");
    expect(markup).toContain('id="competitor-detail"');
    expect(markup).toContain("Open the capture");
    expect(markup).toContain("Package for client");
    expect(markup).toContain("Refresh now");
    expect(markup).toContain("Delivery");
    expect(markup).toContain("Setup");
    expect(markup).toContain("the last 3 checks failed");
    // A failed rollup must never read as a believable zero.
    expect(markup).not.toContain("Checked, and nothing has changed in 30 days.");
    expect(markup).not.toContain('class="f9-evidence-number-value">0</p>');

    const setupMarkup = await renderWatchlistsRoute(degraded, "setup");
    expect(setupMarkup).toContain("Pause watching");
    expect(setupMarkup).toContain("Recent aggregate totals are unavailable");

    const evidenceMarkup = await renderWatchlistsRoute(degraded, "evidence");
    expect(evidenceMarkup).toContain("Share summary");
    expect(evidenceMarkup).toContain("Export CSV");
    expect(evidenceMarkup).toContain("Export JSON");
    expect(evidenceMarkup).toContain("Recent aggregate totals are unavailable");
  });

  it("keeps setup, its explainers and the source-access route behind the Setup tab", async () => {
    const markup = await renderWatchlistsRoute(selectedPanelLoaderData, "setup");

    expect(markup).toContain("Watchlist setup");
    expect(markup).toContain("Save watchlist");
    expect(markup).toContain("How tracking works");
    expect(markup).toContain("Live ad check");
    expect(markup).toContain("Check source access");
    // The change feed panel is not also rendered underneath it (tab label may still show).
    expect(markup).not.toContain('aria-label="What changed"');
    expect(markup).not.toContain("f9-evidence-diff-plate");
  });

  it("keeps evidence, freshness and the glossary behind the Evidence tab", async () => {
    const markup = await renderWatchlistsRoute(selectedPanelLoaderData, "evidence");

    expect(markup).toContain("Evidence and delivery");
    expect(markup).toContain("Recent proof captures");
    expect(markup).toContain("Last good check");
    expect(markup).toContain("1h ago");
    expect(markup).toContain("Evidence labels");
    expect(markup).toContain("f9-evidence-report-glossary");
    expect(markup).not.toContain("Insight depth");
    expect(markup).not.toContain("No evidence yet");
  });

  it("keeps delivery settings and recipient targets behind the Delivery tab", async () => {
    const markup = await renderWatchlistsRoute(selectedPanelLoaderData, "delivery");

    expect(markup).toContain("Delivery settings");
    expect(
      markup.match(/Delivery settings and recipient targets are managed by the workspace owner\./g),
    ).toHaveLength(1);
    expect(markup).toContain("Ask the workspace owner to add or change delivery targets.");
    expect(markup).not.toContain("Slack enabled");
    expect(markup).not.toContain("WhatsApp — not yet available");
    expect(markup).not.toContain("WhatsApp enabled");
  });

  it("renders cache-only discovery status", async () => {
    const cacheOnlyStatus = {
      status: "cache_only",
      provider: "meta_library_browser",
      mode: "cache",
      summary: "Browser Run with cached live results.",
      lastCheckedAt: "2026-04-18T10:06:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
    } as const;

    await mockRouter({
      actionData: undefined,
      // BL-007: the tracking headline and its summary live on the Setup tab.
      searchParams: new URLSearchParams("watchlist=watch-1&tab=setup"),
      loaderData: {
        renderedAt: "2026-04-18T10:59:50.000Z",
        plan: "starter",
        watchlists: [watchlist],
        selectedWatchlist: watchlist,
        eventCandidates: recentCandidates,
        events: recentEvents,
        runs: recentRuns,
        workspaceDeliveryConfig,
        watchlistDeliveryConfig,
        discoveryStatus: cacheOnlyStatus,
        effectiveDeliveryConfig: {
          sensitivityMode: "quiet",
          instantEnabled: true,
          digestEnabled: true,
  digestCadencePreference: "plan_default",
          emailEnabled: true,
          whatsappEnabled: true,
          slackEnabled: false,
          quietHours: {
            startHour: 22,
            endHour: 8,
          },
          timezone: "Asia/Kolkata",
        },
        deliveryTargets,
        workspaceDeliveryTargets: [],
        recentDeliveryAttempts,
        recentProofCaptures,
        proofSummary: {
          totalAttempts: 1,
          successfulAttempts: 1,
          failedAttempts: 0,
          skippedAttempts: 0,
          skippedDueToBudget: 0,
          skippedDueToRateLimit: 0,
          skippedDueToDedupe: 0,
          lastAttemptAt: "2026-04-18T09:59:50.000Z",
          lastSuccessfulProofAt: "2026-04-18T09:59:50.000Z",
        },
        creativeWall: [],
        trendDailyActivity: [],
      },
    });

    const { default: WatchlistsRoute } =
      await import("~/routes/app.watchlists");
    const markup = renderToStaticMarkup(createElement(WatchlistsRoute));

    expect(markup).toContain("Using recent competitor results");
    expect(markup).toContain("Recent results");
    expect(markup).not.toContain("Browser Run");
    expect(markup).not.toContain("cached live results");
  });

  it("uses calm shared customer copy when live ad checks are delayed", async () => {
    const degradedStatus = {
      status: "degraded",
      provider: "meta_library_browser",
      mode: "live",
      summary:
        "Commercial discovery degraded and no cached results are available.",
      lastCheckedAt: "2026-04-18T10:06:00.000Z",
      lastErrorCode: "browser_launch_failed",
      lastErrorMessage: "Browser process exited before startup.",
    } as const;

    await mockRouter({
      actionData: undefined,
      // BL-007: the tracking headline and its summary live on the Setup tab.
      searchParams: new URLSearchParams("watchlist=watch-1&tab=setup"),
      loaderData: {
        renderedAt: "2026-04-18T10:59:50.000Z",
        plan: "starter",
        watchlists: [watchlist],
        selectedWatchlist: watchlist,
        eventCandidates: recentCandidates,
        events: recentEvents,
        runs: recentRuns,
        workspaceDeliveryConfig,
        watchlistDeliveryConfig,
        discoveryStatus: degradedStatus,
        effectiveDeliveryConfig: {
          sensitivityMode: "quiet",
          instantEnabled: true,
          digestEnabled: true,
  digestCadencePreference: "plan_default",
          emailEnabled: true,
          whatsappEnabled: true,
          slackEnabled: false,
          quietHours: {
            startHour: 22,
            endHour: 8,
          },
          timezone: "Asia/Kolkata",
        },
        deliveryTargets,
        workspaceDeliveryTargets: [],
        recentDeliveryAttempts,
        recentProofCaptures,
        proofSummary: {
          totalAttempts: 1,
          successfulAttempts: 1,
          failedAttempts: 0,
          skippedAttempts: 0,
          skippedDueToBudget: 0,
          skippedDueToRateLimit: 0,
          skippedDueToDedupe: 0,
          lastAttemptAt: "2026-04-18T09:59:50.000Z",
          lastSuccessfulProofAt: "2026-04-18T09:59:50.000Z",
        },
        creativeWall: [],
        trendDailyActivity: [],
      },
    });

    const { default: WatchlistsRoute } =
      await import("~/routes/app.watchlists");
    const markup = renderToStaticMarkup(createElement(WatchlistsRoute));

    expect(markup).toContain("Live ad checks are temporarily delayed");
    expect(markup).toContain("results refresh as soon as checks recover");
    expect(markup).toContain("The visual ad check is temporarily delayed");
    expect(markup).not.toContain("Tracking path needs attention");
    expect(markup).not.toContain("The visual ad check could not start");
    expect(markup).not.toContain("Competitor ad checks degraded");
  });
});
