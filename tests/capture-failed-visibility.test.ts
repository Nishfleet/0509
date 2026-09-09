import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createMemoryRouter, RouterProvider } from "react-router";

import { RecentChecksSection, type LatestRunCaptureAttempt } from "~/components/watchlists/recent-checks-section";
import {
  formatCaptureAttemptReasonLabel,
  type CaptureAttemptReasonCode,
} from "~/lib/capture-attempt-reason-code";
import type { WatchlistRunRecord } from "~/lib/types";

/**
 * Issue #2050 — capture_failed visibility in the watchlist run-history
 * surface.
 *
 * The capture-validity gate (BET 4) suppresses phantom transitions — geo
 * variance, cookie/consent walls, partial SPA shells, anti-bot challenges,
 * error pages. A suppressed or failed capture is recorded internally but must
 * also be VISIBLE in the run history, with its reason and a timestamp, never
 * silently dropped. This file is the unit-level regression gate for that
 * surface: it renders the `RecentChecksSection` run-history strip exactly as
 * the competitor detail does and asserts every capture_failed attempt is
 * listed with its human reason (not the raw token) and its timestamp, and
 * that a refusal is visually distinct from a clean capture.
 *
 * Read-path only: no schema change, no migration. It asserts the renderer
 * surfaces the `capture_failed`/`skipped` state the gate already emits.
 */

const RUN: WatchlistRunRecord = {
  id: "run-1",
  watchlistId: "watch-1",
  triggerType: "scheduled",
  status: "succeeded",
  pageBudget: 8,
  pagesScanned: 3,
  baselineFromRunId: null,
  summary: {},
  startedAt: "2026-08-25T09:55:00.000Z",
  finishedAt: "2026-08-25T10:00:00.000Z",
  errorCode: null,
  errorMessage: null,
};


function attempt(overrides: Partial<LatestRunCaptureAttempt>): LatestRunCaptureAttempt {
  return {
    id: "attempt-ok",
    status: "succeeded",
    reasonCode: null,
    urlChecked: "https://example.com/",
    checkedAt: "2026-08-25T10:00:00.000Z",
    ...overrides,
  };
}

/**
 * The suppression categories issue #2050 names — partial load, error page,
 * anti-bot challenge, and a consent-wall phantom — each mapped to a real
 * public reason code the gate emits.
 */
const SUPPRESSION_REASONS: Array<{ reasonCode: CaptureAttemptReasonCode }> = [
  { reasonCode: "partial_load" },
  { reasonCode: "error_page" },
  { reasonCode: "cloudflare_challenge" },
  { reasonCode: "cookie_banner" },
];

/**
 * RecentChecksSection renders react-router <Link>s, so it needs a router
 * context to render to static markup (same pattern as the existing
 * run-history render tests).
 */
function renderSection(latestRunCaptureAttempts: readonly LatestRunCaptureAttempt[]): string {
  const router = createMemoryRouter([
    {
      path: "/",
      element: createElement(RecentChecksSection, {
        runs: [RUN],
        watchlistId: "watch-1",
        checksExpanded: true,
        latestRunCaptureAttempts,
      }),
    },
  ]);
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("capture_failed visibility in run history (#2050)", () => {
  it("renders a capture_failed row with its human reason rather than omitting it", () => {
    const markup = renderSection([
      attempt({ id: "attempt-partial", status: "capture_failed", reasonCode: "partial_load" }),
    ]);

    expect(markup).toContain("What the latest check looked at");
    expect(markup).toContain("Page only partially loaded");
    expect(markup).toContain("No alert sent.");
    // The raw capture_failed/reason tokens never leak into the render.
    expect(markup).not.toContain("capture_failed");
    expect(markup).not.toContain("partial_load");
  });

  it("renders every suppression reason category the issue names", () => {
    for (const { reasonCode } of SUPPRESSION_REASONS) {
      const label = formatCaptureAttemptReasonLabel(reasonCode);
      const markup = renderSection([
        attempt({ id: `attempt-${reasonCode}`, status: "capture_failed", reasonCode }),
      ]);
      expect(markup, reasonCode).toContain(label);
      expect(markup, reasonCode).toContain("No alert sent.");
    }
  });

  it("renders the attempt timestamp alongside each failed row", () => {
    const checkedAt = "2026-08-25T10:00:00.000Z";
    const markup = renderSection([
      attempt({ id: "attempt-time", status: "capture_failed", reasonCode: "error_page", checkedAt }),
    ]);

    // The renderer shows a UTC-labeled datetime for the failed check, so the
    // run history proves when the refusal happened.
    expect(markup).toContain("25 Aug 2026");
    expect(markup).toContain("10:00");
  });

  it("keeps a successful capture visually distinct from a refusal", () => {
    const markup = renderSection([
      attempt({ id: "attempt-ok", status: "succeeded", urlChecked: "https://example.com/" }),
      attempt({ id: "attempt-fail", status: "capture_failed", reasonCode: "error_page", urlChecked: null }),
    ]);

    // A clean capture reads as captured; only the refusal carries the
    // adversarial "No alert sent." proof line.
    expect(markup).toContain("Captured");
    expect(markup).toContain("Page loaded as an error");
    expect(markup).toContain("No alert sent.");
  });

  it("lists all four named suppression categories together as a visible record", () => {
    const markup = renderSection(
      SUPPRESSION_REASONS.map(({ reasonCode }, index) =>
        attempt({
          id: `attempt-${index}`,
          status: "capture_failed",
          reasonCode,
          checkedAt: `2026-08-25T10:0${index}:00.000Z`,
        }),
      ),
    );

    for (const { reasonCode } of SUPPRESSION_REASONS) {
      expect(markup).toContain(formatCaptureAttemptReasonLabel(reasonCode));
    }
    expect(markup.match(/No alert sent\./g)?.length).toBe(SUPPRESSION_REASONS.length);
  });
});