import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { DashboardShell } from "~/components/dashboard-shell";
import { RuledList, RuledRow } from "~/components/workspace/ruled-list";
import { WorkingHeader } from "~/components/workspace/working-header";
import {
  firstChangeMark,
  firstLandingPageEvidence,
  landingPageChangedFieldLabel,
  readChangeMark,
  readLandingPageEvidence,
} from "~/lib/change-mark";
import { LandingPageEvidenceCard } from "~/routes/app.dashboard";
import {
  countCompetitorStates,
  filterCompetitorRows,
  formatCompetitorContextLine,
  resolveCompetitorFilter,
  resolveCompetitorRowLine,
  toCompetitorRows,
} from "~/lib/competitor-list-display";
import {
  DASHBOARD_PRIMARY_NAV,
  DASHBOARD_SETTINGS_NAV,
  isSettingsNavPath,
} from "~/lib/dashboard-navigation";
import { buildOvernightSentence } from "~/lib/overnight-sentence";
import type { WatchEventRecord, WatchlistRecord } from "~/lib/types";

/**
 * BL-030 — the two reference surfaces and the rail that carries them.
 *
 * Every claim these surfaces make has to come off stored evidence. The list
 * loader deliberately does not read per-competitor events, so a row states
 * the SHAPE of what happened and the detail pane states what it was; a
 * sentence that cannot be derived is not written.
 */

function renderRouted(element: ReactElement, path = "/app"): string {
  const Stub = createRoutesStub([{ path, Component: () => element }]);
  return renderToStaticMarkup(<Stub initialEntries={[path]} />);
}

function watchlist(overrides: Partial<WatchlistRecord> = {}): WatchlistRecord {
  return {
    id: "watch-1",
    userId: "user-1",
    name: "Nykaa watch",
    targetType: "advertiser",
    targetId: "nykaa",
    targetFingerprint: "advertiser:nykaa",
    targetLabel: "Nykaa",
    targetCountry: "IN",
    isActive: true,
    lastScannedAt: "2026-07-27T04:00:00.000Z",
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-07-27T04:00:00.000Z",
    ...overrides,
  } as WatchlistRecord;
}

function event(overrides: Partial<WatchEventRecord> = {}): WatchEventRecord {
  return {
    id: "event-1",
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "offer_changed",
    status: "confirmed",
    importanceScore: 60,
    adId: null,
    baselineFromRunId: null,
    candidateId: null,
    proofCaptureId: null,
    title: "Offer price changed on nykaa.com",
    summary: "The offer page moved from $68 to $52.",
    metadata: { from: "$68", to: "$52" },
    confirmedAt: "2026-07-28T03:41:00.000Z",
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: null,
    createdAt: "2026-07-28T03:41:00.000Z",
    ...overrides,
  } as WatchEventRecord;
}

describe("the one green mark", () => {
  it("reads both sides off stored metadata or renders no mark at all", () => {
    expect(readChangeMark(event())).toEqual({ from: "$68", to: "$52" });
    expect(readChangeMark(event({ metadata: { from: "$68" } }))).toBeNull();
    expect(readChangeMark(event({ metadata: {} }))).toBeNull();
  });

  it("refuses a mark whose two halves are equal — that is not a change", () => {
    expect(readChangeMark(event({ metadata: { from: "$52", to: "$52" } }))).toBeNull();
  });

  it("refuses a paragraph: the mark is a token, not a landing page", () => {
    const long = "a".repeat(120);
    expect(readChangeMark(event({ metadata: { from: long, to: "$52" } }))).toBeNull();
  });

  it("takes the newest event that actually has a readable mark", () => {
    const marked = firstChangeMark([
      event({ id: "no-mark", metadata: {} }),
      event({ id: "marked" }),
    ]);
    expect(marked?.event.id).toBe("marked");
  });
});

describe("the landing-page evidence card", () => {
  function landingEvent(
    overrides: Partial<WatchEventRecord> = {},
  ): WatchEventRecord {
    return event({
      eventType: "landing_page_headline_changed",
      title: "Landing page headline changed",
      summary: "The landing-page headline changed.",
      ...overrides,
    });
  }

  it("reads stored before/after screenshot artifacts into a labelled proof card", () => {
    const evidence = readLandingPageEvidence(
      landingEvent({
        metadata: {
          from: "Glow like never before with our festival edit, live for 7 days only",
          to: "Festival glow starts here",
          beforeCreativeImageUrl: "https://cdn.example.com/lp-before.png",
          afterCreativeImageUrl: "https://cdn.example.com/lp-after.png",
          sourceUrl: "https://nykaa.com/festive-glow",
          beforeCapturedAt: "2026-07-27T04:00:00.000Z",
          capturedAt: "2026-07-28T04:00:00.000Z",
        },
      }),
    );

    expect(evidence?.proofState).toBe("screenshot_proof");
    expect(evidence?.beforeImageUrl).toBe("https://cdn.example.com/lp-before.png");
    expect(evidence?.afterImageUrl).toBe("https://cdn.example.com/lp-after.png");
    expect(evidence?.sourceUrl).toBe("https://nykaa.com/festive-glow");
    expect(evidence?.beforeCapturedAt).toBe("2026-07-27T04:00:00.000Z");
    expect(evidence?.capturedAt).toBe("2026-07-28T04:00:00.000Z");
    expect(evidence?.changedField).toBe("Headline");
  });

  it("keeps long landing-page values readable instead of forcing them through the short-token mark", () => {
    const long =
      "Flat 40% off everything in your cart with code FESTIVE40 when you spend over ₹1,499, today only.";
    const changed = landingEvent({ metadata: { from: long, to: "Festival sale live" } });

    expect(readChangeMark(changed)).toBeNull();
    const evidence = readLandingPageEvidence(changed);
    expect(evidence?.from).toBe(long);
    expect(evidence?.to).toBe("Festival sale live");
    expect(evidence?.proofState).toBe("proof_unavailable");
  });

  it("marks the card proof-pending when one artifact is missing, never screenshot proof", () => {
    const evidence = readLandingPageEvidence(
      landingEvent({
        metadata: {
          from: "First headline variant with a long body copy",
          to: "Second variant",
          beforeCreativeImageUrl: "https://cdn.example.com/lp-before.png",
        },
      }),
    );

    expect(evidence?.proofState).toBe("proof_pending");
    expect(evidence?.beforeImageUrl).toBe("https://cdn.example.com/lp-before.png");
    expect(evidence?.afterImageUrl).toBeNull();
  });

  it("treats an invalid artifact URL as missing, not as stored proof", () => {
    const evidence = readLandingPageEvidence(
      landingEvent({
        metadata: {
          from: "Long headline text that exceeds the token mark limit",
          to: "Short",
          beforeCreativeImageUrl: "http://insecure.example.com/lp-before.png",
          afterCreativeImageUrl: "not a url",
        },
      }),
    );

    expect(evidence?.beforeImageUrl).toBeNull();
    expect(evidence?.afterImageUrl).toBeNull();
    expect(evidence?.proofState).toBe("proof_pending");
  });

  it("leaves short token-markable landing-page changes to the existing mark", () => {
    const short = landingEvent({ metadata: { from: "$68", to: "$52" } });
    expect(readChangeMark(short)).toEqual({ from: "$68", to: "$52" });
    expect(readLandingPageEvidence(short)).toBeNull();
  });

  it("takes the newest event that carries landing-page evidence", () => {
    const found = firstLandingPageEvidence([
      event({ id: "plain-offer", metadata: { from: "$68", to: "$52" } }),
      landingEvent({
        id: "evidence",
        metadata: { from: "A long headline that certainly exceeds the token limit", to: "x" },
      }),
    ]);
    expect(found?.event.id).toBe("evidence");
  });

  it("names the changed region from the event type with a truthful fallback", () => {
    expect(landingPageChangedFieldLabel("landing_page_url_changed")).toBe("Destination URL");
    expect(landingPageChangedFieldLabel("landing_page_offer_changed")).toBe("Offer / price");
    expect(landingPageChangedFieldLabel("landing_page_form_changed")).toBe("Form state");
    expect(landingPageChangedFieldLabel("mystery_event")).toBe("Landing page");
  });

  it("renders the dashboard card with screenshots, source and timestamps", () => {
    const markup = renderRouted(
      <LandingPageEvidenceCard
        event={landingEvent({
          metadata: {
            from: "Glow like never before with our festival edit",
            to: "Festival glow starts here",
            beforeCreativeImageUrl: "https://cdn.example.com/lp-before.png",
            afterCreativeImageUrl: "https://cdn.example.com/lp-after.png",
            sourceUrl: "https://nykaa.com/festive-glow",
            beforeCapturedAt: "2026-07-27T04:00:00.000Z",
            capturedAt: "2026-07-28T04:00:00.000Z",
          },
        })}
        evidence={{
          from: "Glow like never before with our festival edit",
          to: "Festival glow starts here",
          beforeImageUrl: "https://cdn.example.com/lp-before.png",
          afterImageUrl: "https://cdn.example.com/lp-after.png",
          sourceUrl: "https://nykaa.com/festive-glow",
          beforeCapturedAt: "2026-07-27T04:00:00.000Z",
          capturedAt: "2026-07-28T04:00:00.000Z",
          changedField: "Headline",
          proofState: "screenshot_proof",
        }}
        timeZone="UTC"
      />,
    );

    expect(markup).toContain("Landing page evidence");
    expect(markup).toContain('src="https://cdn.example.com/lp-before.png"');
    expect(markup).toContain('src="https://cdn.example.com/lp-after.png"');
    expect(markup).toContain("https://nykaa.com/festive-glow");
    expect(markup).toContain("27 Jul 2026");
    expect(markup).toContain("28 Jul 2026");
    expect(markup).not.toContain("Screenshot proof pending");
  });

  it("renders an explicit pending state with no image when an artifact is missing", () => {
    const markup = renderRouted(
      <LandingPageEvidenceCard
        event={landingEvent({
          metadata: {
            from: "First headline variant with a long body copy",
            to: "Second variant",
            beforeCreativeImageUrl: "https://cdn.example.com/lp-before.png",
          },
        })}
        evidence={{
          from: "First headline variant with a long body copy",
          to: "Second variant",
          beforeImageUrl: "https://cdn.example.com/lp-before.png",
          afterImageUrl: null,
          sourceUrl: "https://nykaa.com/festive-glow",
          beforeCapturedAt: null,
          capturedAt: "2026-07-28T04:00:00.000Z",
          changedField: "Headline",
          proofState: "proof_pending",
        }}
      />,
    );

    expect(markup).not.toContain("<img");
    expect(markup).toContain("Screenshot proof pending");
    expect(markup).toContain("https://nykaa.com/festive-glow");
  });

  it("never fabricates a screenshot for an event with no stored artifacts", () => {
    const markup = renderRouted(
      <LandingPageEvidenceCard
        event={landingEvent({
          metadata: {
            from: "Flat 40% off everything in your cart today only",
            to: "Festival sale live",
          },
        })}
        evidence={{
          from: "Flat 40% off everything in your cart today only",
          to: "Festival sale live",
          beforeImageUrl: null,
          afterImageUrl: null,
          sourceUrl: null,
          beforeCapturedAt: null,
          capturedAt: null,
          changedField: "Headline",
          proofState: "proof_unavailable",
        }}
      />,
    );

    expect(markup).not.toContain("<img");
    expect(markup).toContain("No screenshots stored for this change");
    expect(markup).toContain("Flat 40% off everything in your cart today only");
  });
});

describe("the overnight sentence", () => {
  it("falls back to the brief's own state headline when nothing was captured", () => {
    expect(
      buildOvernightSentence({
        briefTitle: "Quiet check completed",
        briefSummary: "All quiet - 12 ads checked across 3 competitors.",
        changeCount: 0,
        headline: null,
        mark: null,
        quietCompetitors: 3,
      }),
    ).toEqual({
      lead: "Quiet check completed. All quiet - 12 ads checked across 3 competitors.",
      mark: null,
      tail: "",
    });
  });

  it("names the change, carries the mark, and states what did not move", () => {
    const sentence = buildOvernightSentence({
      briefTitle: "2 competitor moves to review",
      briefSummary: "unused",
      changeCount: 2,
      headline: "Offer price changed on nykaa.com",
      mark: { from: "$68", to: "$52" },
      quietCompetitors: 7,
    });
    expect(sentence.lead).toBe("Offer price changed on nykaa.com — ");
    expect(sentence.mark).toEqual({ from: "$68", to: "$52" });
    expect(sentence.tail).toBe(
      ". 1 other change is on file. Nothing moved on your other 7 competitors.",
    );
  });

  it("still says what happened when there is no stored before and after", () => {
    const sentence = buildOvernightSentence({
      briefTitle: "1 competitor move to review",
      briefSummary: "unused",
      changeCount: 1,
      headline: "CTA changed on boat-lifestyle.com",
      mark: null,
      quietCompetitors: 0,
    });
    expect(sentence.mark).toBeNull();
    expect(sentence.lead).toBe("CTA changed on boat-lifestyle.com.");
  });
});

describe("the competitors list", () => {
  const rows = toCompetitorRows({
    watchlists: [
      watchlist({ id: "caught" }),
      watchlist({ id: "attention" }),
      watchlist({ id: "watching", lastScannedAt: null }),
      watchlist({ id: "quiet" }),
      watchlist({ id: "paused", isActive: false }),
    ],
    capturedChanges: { caught: 2 },
    failedChecks: { attention: 4 },
    windowDays: 30,
  });

  it("writes one plain sentence per state, and quiet is a finding not a gap", () => {
    expect(rows.map((row) => [row.state, row.line])).toEqual([
      ["caught", "2 changes captured in the last 30 days."],
      [
        "attention",
        "4 checks in a row failed. We're still retrying and the history stays.",
      ],
      [
        "watching",
        "No completed check yet. This row updates itself when the first capture lands.",
      ],
      ["quiet", "Checked, and nothing has changed in the last 30 days."],
      ["paused", "Paused. No checks run and the history stays."],
    ]);
  });

  it("never colours a status without also saying it in words", () => {
    expect(rows.map((row) => [row.statusLabel, row.statusTone])).toEqual([
      ["Caught", "on"],
      ["Needs attention", "bad"],
      ["Watching", "quiet"],
      ["Quiet", "quiet"],
      ["Paused", "quiet"],
    ]);
  });

  it("counts a competitor still waiting for its first capture in All only", () => {
    // Calling it quiet would claim we checked and found nothing, which is
    // exactly the dishonest read the board exists to avoid.
    expect(countCompetitorStates(rows)).toEqual({
      all: 5,
      caught: 1,
      quiet: 1,
      attention: 1,
      paused: 1,
    });
  });

  it("resolves an unknown, blank or absent filter to All rather than 404ing", () => {
    expect(resolveCompetitorFilter(null)).toBe("all");
    expect(resolveCompetitorFilter("  ")).toBe("all");
    expect(resolveCompetitorFilter("nonsense")).toBe("all");
    expect(resolveCompetitorFilter("PAUSED")).toBe("paused");
  });

  it("filters to exactly the rows in that state", () => {
    expect(filterCompetitorRows(rows, "caught").map((row) => row.id)).toEqual(["caught"]);
    expect(filterCompetitorRows(rows, "all")).toHaveLength(5);
  });

  it("answers the page's own question in the context line", () => {
    expect(formatCompetitorContextLine({ rows, windowDays: 30 })).toBe(
      "5 competitors. 1 changed in the last 30 days.",
    );
    expect(
      formatCompetitorContextLine({
        rows: toCompetitorRows({
          watchlists: [watchlist({ isActive: false })],
          capturedChanges: {},
          windowDays: 30,
        }),
        windowDays: 30,
      }),
    ).toBe("1 competitor. All paused — no checks run until you resume one.");
    expect(formatCompetitorContextLine({ rows: [], windowDays: 30 })).toBe(
      "No competitors yet. Add one and its first check starts immediately.",
    );
  });

  it("never invents a longest-quiet-run it did not measure", () => {
    for (const row of rows) {
      expect(row.line).not.toMatch(/\d+ days ago|since \d/);
    }
  });
});

describe("the ruled row", () => {
  it("is five cells: name, one sentence, one status word, one time, one chevron", () => {
    const markup = renderRouted(
      <RuledList>
        <RuledRow
          name="Glossier"
          say="2 changes captured in the last 30 days."
          status="Caught"
          statusTone="on"
          time="27 Jul 2026"
          to="/app/watchlists?watchlist=w1"
        />
      </RuledList>,
    );
    expect(markup).toContain('class="f9-wk-nm"');
    expect(markup).toContain('class="f9-wk-say"');
    expect(markup).toContain('class="f9-wk-st is-on"');
    expect(markup).toContain('class="f9-wk-tm"');
    expect(markup).toContain('class="f9-wk-go"');
    // No boxes: a status is a word, never a chip or a pill.
    expect(markup).not.toContain("f9-pill");
    expect(markup).not.toContain("f9-evidence-stamp");
  });

  it("gives a summary row the body face — Bricolage means a watched entity", () => {
    const markup = renderRouted(
      <RuledList>
        <RuledRow name="Setup" plain say="One step left" />
      </RuledList>,
    );
    expect(markup).toContain("f9-wk-row is-plain");
  });

  it("keeps a real in-row control above the row-wide hit area", () => {
    const markup = renderRouted(
      <RuledList>
        <RuledRow
          lead={<input type="checkbox" />}
          name="Glossier"
          to="/app/watchlists?watchlist=w1"
          trail={<button type="submit">Mark done</button>}
        />
      </RuledList>,
    );
    expect(markup).toContain("f9-wk-row has-lead has-trail");
    expect(markup).toContain('class="f9-wk-row-lead"');
    expect(markup).toContain('class="f9-wk-row-trail"');
    // The chevron gives way to the control rather than sitting beside it.
    expect(markup).not.toContain('class="f9-wk-go"');
  });
});

describe("the working header", () => {
  it("is one row: title left, at most one action inline right, one context line", () => {
    const markup = renderRouted(
      <WorkingHeader
        action={{ label: "Add competitor", to: "/search" }}
        context="9 competitors. 2 changed in the last 30 days."
        title="Competitors"
      />,
    );
    expect(markup.match(/class="f9-wk-btn"/g)).toHaveLength(1);
    expect(markup).toContain('<h1 class="f9-wk-title">Competitors</h1>');
    expect(markup).toContain('class="f9-wk-context"');
  });

  it("renders no action at all rather than a disabled one", () => {
    const markup = renderRouted(<WorkingHeader action={null} title="Overview" />);
    expect(markup).not.toContain("f9-wk-btn");
  });
});

describe("the rail", () => {
  const shellSource = readFileSync("app/components/dashboard-shell.tsx", "utf8");

  function renderShell(pathname = "/app") {
    return renderRouted(
      <DashboardShell
        accountDetail="Competitor intelligence workspace"
        accountLabel="Workspace"
        accountTitle="Five to Nine"
        onCommandPalette={() => {}}
        userEmail="owner@example.com"
        userName="Owner"
      >
        <p>content</p>
      </DashboardShell>,
      pathname,
    );
  }

  it("shows five destinations and no disclosure — the ratified IA", () => {
    const markup = renderShell();
    const rows = markup.match(/class="f9-dash-nav-link f9-wk-nav-a[^"]*"/g) ?? [];
    expect(rows).toHaveLength(5);
    expect(markup).not.toContain("Workspace &amp; account");
    expect(markup).not.toContain("f9-wk-more");
  });

  it("makes ⌘K visible chrome rather than folklore", () => {
    const markup = renderShell();
    expect(markup).toContain('class="f9-wk-search"');
    expect(markup).toContain('aria-keyshortcuts="Meta+K Control+K"');
    expect(markup).toContain("⌘K");
  });

  it("marks the owning destination active on a member page", () => {
    // On /app/billing the Settings row is the active row — a customer deep
    // inside a member page is never nowhere.
    const markup = renderShell("/app/billing");
    const active = markup.match(/f9-dash-nav-link[^"]*is-active[^"]*"[^>]*href="([^"]+)"/);
    expect(markup).toContain('href="/app/settings"');
    expect(active?.[1]).toBe("/app/settings");
  });

  it("carries a workspace footer block, and every route is still reachable", () => {
    const markup = renderShell();
    expect(markup).toContain('class="f9-wk-foot"');
    expect(markup).toContain('class="f9-wk-avatar"');
    expect(markup).toContain("Sign out");
    // BL-035 re-adjudication: these duplicated the signed-in Help & support
    // destination. Identity + the session action are the complete foot.
    expect(markup).not.toContain('href="/help"');
    expect(markup).not.toContain('href="/docs"');
    expect(markup).not.toContain("mailto:support@0509.io");
    for (const item of DASHBOARD_PRIMARY_NAV.flatMap((section) => section.items)) {
      if (item.requiresPresence) continue;
      expect(markup).toContain(`href="${item.to}"`);
    }
  });

  it("keeps the rail text-only: no icons, no mono caps, no group labels", () => {
    expect(shellSource).not.toContain("navIconFor(item)\n                return");
    const railSection = shellSource.slice(shellSource.indexOf("f9-wk-rail"));
    expect(railSection).not.toContain("f9-dash-nav-section");
    expect(railSection).not.toContain("<Icon />");
  });
});
