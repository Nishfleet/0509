import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignupFirstBriefView } from "~/components/signup-first-brief-view";
import type { SignupFirstBriefLoaderData } from "~/lib/first-brief";
import { mockReactRouter } from "../helpers/mock-react-router";

/**
 * Issue #3176 — the signup waiting surface's #3176 progress block.
 *
 * While the activation fan-out runs, the waiting state must not be silent:
 * it states the planned denominator, the finished count, and each source's
 * own honest state ("scanning N sources, k done", per-source ticks). When
 * the run has not planned its fan-out yet, the block stays hidden — never a
 * padded or fabricated count. The D1→loader→wire path is covered by
 * tests/integration/signup-scan-progress.integration.test.ts; this test
 * locks the render contract.
 */

function waitingData(
  overrides: Partial<Extract<SignupFirstBriefLoaderData, { status: "waiting" }>> = {},
): SignupFirstBriefLoaderData {
  return {
    step: "first-brief",
    status: "waiting",
    watchlistName: "Glowkart",
    ...overrides,
  };
}

describe("SignupFirstBriefView waiting state (#3176 progress)", () => {
  beforeEach(() => {
    mockReactRouter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the denominator, the finished count, and every per-source tick", () => {
    const html = renderToStaticMarkup(
      <SignupFirstBriefView
        data={waitingData({
          scanProgress: {
            total: 3,
            done: 1,
            remaining: 2,
            sources: [
              { label: "Google Ads", status: "done", detail: "changes:0" },
              { label: "TikTok Ads", status: "running", detail: null },
              { label: "RSS / Atom / JSON Feed", status: "timed_out", detail: "budget:30000ms" },
            ],
          },
        })}
      />,
    );

    expect(html).toContain("Scanning 3 sources, 1 done.");
    expect(html).toContain("Google Ads");
    expect(html).toContain("done");
    expect(html).toContain("TikTok Ads");
    expect(html).toContain("running");
    expect(html).toContain("RSS / Atom / JSON Feed");
    expect(html).toContain("timed out");
    // The block announces itself to assistive tech as it updates.
    expect(html).toContain('aria-live="polite"');
  });

  it("marks every source's status with its state so the words are machine-greppable too", () => {
    const html = renderToStaticMarkup(
      <SignupFirstBriefView
        data={waitingData({
          watchlistName: null,
          scanProgress: {
            total: 1,
            done: 0,
            remaining: 1,
            sources: [{ label: "Subdomains", status: "pending", detail: null }],
          },
        })}
      />,
    );

    expect(html).toContain("is-pending");
    expect(html).toContain("queued");
  });

  it("hides the block when the run has not planned its fan-out yet", () => {
    const html = renderToStaticMarkup(
      <SignupFirstBriefView data={waitingData({})} />,
    );

    expect(html).not.toContain("f9-signup-scan-progress");
    expect(html).toContain("We're scanning Glowkart now.");
  });

  it("an all-zero planning pass hides the block too", () => {
    const html = renderToStaticMarkup(
      <SignupFirstBriefView
        data={waitingData({
          scanProgress: { total: 0, done: 0, remaining: 0, sources: [] },
        })}
      />,
    );

    expect(html).not.toContain("f9-signup-scan-progress");
  });
});
