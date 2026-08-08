// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import {
  EventChangesSection,
  resolveNewestMarkedEventId,
} from "~/components/watchlists/event-changes-section";
import type {
  ProofCaptureRecord,
  WatchEventRecord,
  WatchlistRunRecord,
} from "~/lib/types";

/**
 * BL-030 round 4 — the announcement green, proved against a real tree.
 *
 * Round 3 shipped a CSS rule whose selector matched NOTHING in the live DOM
 * (`.f9-evidence-change-feed > :first-child` selects the per-event wrapper div, and
 * `.f9-evidence-detail-main > .f9-evidence-diff-plate:first-of-type` needs a direct child
 * that does not exist), so every plate's NOW token painted ink and the
 * surface's advertised green was dead. It shipped because the spec asserted
 * that the selector STRING existed in app.css — an assertion that cannot fail
 * for a selector that matches nothing.
 *
 * These cases render the component and resolve the ACTUAL rule from app.css
 * against the produced DOM with `querySelectorAll`. If the `is-newest` wiring
 * breaks, or the rule is re-written to a selector that misses the markup, the
 * "resolves against the rendered tree" case fails. Mutation evidence for that
 * is recorded in the build report §12.
 */

/**
 * The selector is READ OUT OF app.css rather than hardcoded here, so the test
 * always resolves whatever rule actually ships. Round 3's positional selector
 * would fail this file on "matches nothing", which is the real defect — not on
 * a string mismatch, which would only prove the two files disagree.
 */
function shippedGreenMarkSelector(): string {
  const css = readFileSync("app/app.css", "utf8");
  const scoped = css
    .slice(css.indexOf("BL-030 — the landing-language workspace layer"))
    // Comments are documentation, not part of a selector.
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...scoped.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(
    ([, selector, body]) =>
      /\.f9-evidence-diff-value mark/.test(selector) && /background:\s*var\(--green\)/.test(body),
  );
  expect(rules, "exactly one rule may paint a NOW token green").toHaveLength(1);
  return rules[0][1].trim().replace(/\s+/g, " ");
}

const GREEN_RULE = shippedGreenMarkSelector();

function run(id: string, finishedAt: string): WatchlistRunRecord {
  return {
    id,
    watchlistId: "w1",
    triggerType: "scheduled",
    status: "succeeded",
    pageBudget: 1,
    pagesScanned: 1,
    baselineFromRunId: null,
    summary: {},
    startedAt: finishedAt,
    finishedAt,
  } as WatchlistRunRecord;
}

function capture(id: string, succeededAt: string): ProofCaptureRecord {
  return {
    id,
    watchlistId: "w1",
    eventId: null,
    status: "succeeded",
    attemptedAt: succeededAt,
    succeededAt,
  } as unknown as ProofCaptureRecord;
}

function event(
  id: string,
  overrides: Partial<WatchEventRecord> = {},
): WatchEventRecord {
  return {
    id,
    watchlistId: "w1",
    runId: `run-${id}`,
    eventType: "offer_changed",
    status: "confirmed",
    importanceScore: 60,
    adId: null,
    baselineFromRunId: `run-baseline-${id}`,
    candidateId: null,
    proofCaptureId: `cap-${id}`,
    title: `Offer changed (${id})`,
    summary: "The offer page moved.",
    metadata: { from: "$68", to: "$52" },
    confirmedAt: "2026-07-28T03:41:00.000Z",
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: null,
    createdAt: "2026-07-28T03:41:00.000Z",
    ...overrides,
  } as WatchEventRecord;
}

/**
 * Mirrors the release fixture's shape, which is what made round 3's positional
 * selector miss: the NEWEST event is a suppressed record with no mark at all,
 * and the two markable plates sit below it.
 */
function fixture() {
  const events = [
    // newest, but suppressed and scan-native — renders a change RECORD, no mark
    event("suppressed", {
      status: "suppressed",
      metadata: {},
      proofCaptureId: null,
      baselineFromRunId: null,
    }),
    event("newest-marked"),
    event("older-marked"),
  ];
  const proofCapturesById = new Map<string, ProofCaptureRecord>([
    ["cap-newest-marked", capture("cap-newest-marked", "2026-07-28T03:41:00.000Z")],
    ["cap-older-marked", capture("cap-older-marked", "2026-07-20T03:41:00.000Z")],
  ]);
  const recentProofCaptures = [
    capture("cap-newest-marked", "2026-07-28T03:41:00.000Z"),
    capture("cap-prior-newest", "2026-07-27T03:41:00.000Z"),
    capture("cap-older-marked", "2026-07-20T03:41:00.000Z"),
    capture("cap-prior-older", "2026-07-19T03:41:00.000Z"),
  ];
  const runs = [
    run("run-suppressed", "2026-07-28T04:00:00.000Z"),
    run("run-newest-marked", "2026-07-28T03:41:00.000Z"),
    run("run-baseline-newest-marked", "2026-07-27T03:41:00.000Z"),
    run("run-older-marked", "2026-07-20T03:41:00.000Z"),
    run("run-baseline-older-marked", "2026-07-19T03:41:00.000Z"),
  ];
  return { events, proofCapturesById, recentProofCaptures, runs };
}

function renderFeed() {
  const { events, proofCapturesById, recentProofCaptures, runs } = fixture();
  const element = createElement(EventChangesSection, {
    watchlistId: "w1",
    data: {
      events,
      runs,
      selectedWatchlist: { id: "w1", name: "Nykaa watch", lastScannedAt: "2026-07-28T03:41:00.000Z" },
      plan: "starter",
      effectiveDeliveryConfig: { timezone: "UTC" },
      highlightedEventId: null,
    },
    sourceCanSchedule: true,
    renderedAt: new Date("2026-07-28T09:00:00.000Z"),
    proofCapturesById,
    recentProofCaptures,
    lastAttemptByEventId: new Map(),
  });
  const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
  const markup = renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
  // The rule is scoped to `.f9-wk-page`, which is the rebuilt route's own
  // wrapper — the record only ever renders inside one.
  document.body.innerHTML = `<div class="f9-wk-page">${markup}</div>`;
  return document.body;
}

describe("the announcement green on the competitor record", () => {
  it("names the newest event that actually carries a mark, skipping suppressed records", () => {
    const { events, proofCapturesById, recentProofCaptures, runs } = fixture();
    expect(
      resolveNewestMarkedEventId({
        events,
        proofCapturesById,
        recentProofCaptures,
        runsById: new Map(runs.map((r) => [r.id, r])),
      }),
    ).toBe("newest-marked");
  });

  it("names nothing when no event in the feed carries a mark", () => {
    const runs = [run("run-a", "2026-07-28T04:00:00.000Z")];
    expect(
      resolveNewestMarkedEventId({
        events: [event("a", { metadata: {}, proofCaptureId: null, baselineFromRunId: null })],
        proofCapturesById: new Map(),
        recentProofCaptures: [],
        runsById: new Map(runs.map((r) => [r.id, r])),
      }),
    ).toBeNull();
  });

  it("puts is-newest on exactly one plate — the newest markable one", () => {
    const body = renderFeed();
    const plates = [...body.querySelectorAll(".f9-evidence-diff-plate")];
    expect(plates.length).toBeGreaterThanOrEqual(2);
    const newest = body.querySelectorAll(".f9-evidence-diff-plate.is-newest");
    expect(newest).toHaveLength(1);
    // It is the first plate in document order, and the suppressed record above
    // it never becomes a plate at all.
    expect(plates[0]).toBe(newest[0]);
    expect(body.querySelectorAll(".f9-evidence-change-record.is-newest")).toHaveLength(0);
    expect(body.querySelectorAll(".f9-evidence-change-record")).toHaveLength(1);
  });

  it("RESOLVES THE REAL RULE from app.css against the rendered tree", () => {
    // This is the case round 3 did not have. It reads the shipped selector out
    // of app.css and runs it against the DOM the component actually produces,
    // so a rule that matches nothing fails here instead of passing a
    // string-contains check.
    const body = renderFeed();
    const painted = body.querySelectorAll(GREEN_RULE);
    expect(
      painted,
      "the green rule must select exactly one NOW token in the real markup",
    ).toHaveLength(1);
    expect(painted[0].tagName.toLowerCase()).toBe("mark");
    expect(painted[0].textContent).toBe("$52");

    // Every other NOW token in the feed is an archived record and is NOT
    // selected by the green rule.
    const allMarks = body.querySelectorAll(".f9-evidence-diff-value mark");
    expect(allMarks.length).toBeGreaterThan(1);
    expect(allMarks.length - painted.length).toBeGreaterThanOrEqual(1);
    const olderPlate = [...body.querySelectorAll(".f9-evidence-diff-plate")][1];
    expect(olderPlate.querySelectorAll(".f9-evidence-diff-value mark")).toHaveLength(1);
    expect(olderPlate.matches(".is-newest")).toBe(false);
  });

  it("selects nothing when the feed has no markable event", () => {
    const runs = [run("run-a", "2026-07-28T04:00:00.000Z")];
    const element = createElement(EventChangesSection, {
      watchlistId: "w1",
      data: {
        events: [
          event("a", {
            status: "suppressed",
            metadata: {},
            proofCaptureId: null,
            baselineFromRunId: null,
          }),
        ],
        runs,
        selectedWatchlist: { id: "w1", name: "Nykaa watch", lastScannedAt: "2026-07-28T03:41:00.000Z" },
        plan: "starter",
        effectiveDeliveryConfig: { timezone: "UTC" },
        highlightedEventId: null,
      },
      sourceCanSchedule: true,
      renderedAt: new Date("2026-07-28T09:00:00.000Z"),
      proofCapturesById: new Map(),
      recentProofCaptures: [],
      lastAttemptByEventId: new Map(),
    });
    const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
    document.body.innerHTML = `<div class="f9-wk-page">${renderToStaticMarkup(
      createElement(Stub, { initialEntries: ["/"] }),
    )}</div>`;
    // A workspace whose only stored change is suppressed announces nothing,
    // and shows no green. That is a real state, not a failure.
    expect(document.body.querySelectorAll(GREEN_RULE)).toHaveLength(0);
    expect(document.body.querySelectorAll(".f9-evidence-diff-plate")).toHaveLength(0);
  });
});
