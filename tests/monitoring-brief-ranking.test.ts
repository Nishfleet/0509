/**
 * Issue #3016 — the digest brief is re-ranked around commercial-field changes;
 * creative churn becomes a one-line footnote.
 *
 * This is the issue's verify gate: `node --test tests/monitoring-brief-ranking.test.ts`
 * must pass. The file runs under BOTH runners:
 *
 * - bare node (`node --test`): app modules load through
 *   ./monitoring-brief-ranking.resolve-hook.mjs (a resolve-only hook that maps
 *   the `~/lib/...` tsconfig alias to real files; node's native type stripping
 *   handles the TS). Registered only in this arm.
 * - vitest (`npm test`, project node): vite resolves the alias itself; the
 *   hook is never registered.
 *
 * Both arms run the same scenarios with `node:assert/strict`. The vitest arm
 * additionally loads the full digest-email module (its import chain is
 * bundler-only) to pin the delivered footnote lines and evidence deep links.
 *
 * Scenarios map 1:1 to the issue's acceptance bullets:
 * 1. landing_page_offer/headline/cta/form/url changes ARE the headline items,
 *    ranked offer/price first, each carrying before/after values and evidence
 *    deep links.
 * 2. ad_new/ad_inactive collapse into one counted line and never fire an
 *    instant alert alone.
 * 3. the why-this-matters weighting (offer/price above creative churn) matches
 *    the published docs.
 * 4. the headline-ratio guard measures the >=60% BET 1 target on a
 *    20-competitor cohort-shaped stream.
 */
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";

import type { WatchEventRecord, WorkspaceDeliveryConfigRecord } from "~/lib/types";

const IS_VITEST = process.env.VITEST !== undefined;

const T0 = "2026-09-11T09:00:00.000Z";
const T1 = "2026-09-11T15:30:00.000Z";

type Scenario = { name: string; run: () => Promise<void> | void };
const scenarios: Scenario[] = [];
function scenario(name: string, run: () => Promise<void> | void) {
  scenarios.push({ name, run });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface RerankItem {
  eventType?: string;
  metadata?: Record<string, unknown>;
}

function item(eventType: string, priorityScore?: number, extra: Record<string, unknown> = {}): RerankItem {
  return {
    eventType,
    metadata: {
      ...(priorityScore === undefined ? {} : { priorityScore }),
      ...extra,
    },
  };
}

/** A churn-heavy mixed stream: 7 new ads, 3 retired, 5 landing fields, 2 page changes. */
function mixedStream(): RerankItem[] {
  return [
    ...Array.from({ length: 7 }, () => item("ad_new")),
    ...Array.from({ length: 3 }, () => item("ad_inactive")),
    item("landing_page_form_changed", 90),
    item("landing_page_headline_changed", 50),
    item("landing_page_url_changed", 10),
    item("landing_page_cta_changed", 95),
    item("landing_page_offer_changed", 40),
    item("website_page_changed", 85, { eventId: "wev-page-1" }),
    item("website_page_changed", 85, { eventId: "wev-page-2" }),
  ];
}

const workspaceConfig: WorkspaceDeliveryConfigRecord = {
  id: "wsdc-1",
  userId: "user-1",
  sensitivityMode: "auto",
  instantEnabled: true,
  digestEnabled: true,
  digestCadencePreference: "plan_default",
  emailEnabled: true,
  whatsappEnabled: false,
  slackEnabled: false,
  teamsEnabled: false,
  quietHours: null,
  timezone: "UTC",
  createdAt: T0,
  updatedAt: T0,
};

function watchEvent(over: Partial<WatchEventRecord> & { eventType: string }): WatchEventRecord {
  return {
    id: "wev-1",
    watchlistId: "watch-1",
    runId: "run-1",
    status: "confirmed",
    importanceScore: 100,
    adId: null,
    baselineFromRunId: null,
    candidateId: null,
    proofCaptureId: null,
    title: "Change detected",
    summary: "",
    metadata: {},
    confirmedAt: T0,
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: null,
    createdAt: T0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Bullet 1 + 3: the headline stream is the five landing_page_* commercial
// fields, offer/price first, by the published why-this-matters weighting.
// ---------------------------------------------------------------------------

scenario("headline items are the five landing_page_* commercial fields, offer/price first", async () => {
  const {
    rerankDigestBrief,
    LANDING_PAGE_HEADLINE_EVENT_TYPES,
  } = await import("~/lib/digest-rerank");

  const rerank = rerankDigestBrief(mixedStream());

  assert.deepEqual(
    rerank.headlineItems.map((i) => i.eventType),
    [
      "landing_page_offer_changed",
      "landing_page_cta_changed",
      "landing_page_url_changed",
      "landing_page_headline_changed",
      "landing_page_form_changed",
    ],
    "type weight dominates ordering: offer(1000+40) > cta(800+95) > url > headline > form",
  );
  assert.deepEqual(
    [...rerank.headlineItems.map((i) => i.eventType)].sort(),
    [...LANDING_PAGE_HEADLINE_EVENT_TYPES].sort(),
    "every headline type ranks, and nothing else does",
  );
  assert.equal(rerank.headlineItems.length, 5);
});

scenario("why-this-matters weights offer/price above creative churn and every other type", async () => {
  const {
    whyThisMattersScore,
    whyThisMattersScoreForRecord,
    landingPageTypeWeight,
  } = await import("~/lib/digest-rerank");

  // Bullet 3: offer/price above creative churn — a maximum-importance new-ad
  // ping can never outscore a low-importance offer change.
  const adNewTopImportance = whyThisMattersScoreForRecord({
    eventType: "ad_new",
    importanceScore: 100,
  });
  const offerLowImportance = whyThisMattersScoreForRecord({
    eventType: "landing_page_offer_changed",
    importanceScore: 10,
  });
  assert.equal(landingPageTypeWeight("ad_new"), 0, "creative churn carries no type weight");
  assert.equal(landingPageTypeWeight("ad_inactive"), 0);
  assert.ok(
    offerLowImportance > adNewTopImportance,
    `offer (weight 1000 + 10) must outrank a max-importance ad_new (0 + 100): ${offerLowImportance} vs ${adNewTopImportance}`,
  );
  assert.equal(whyThisMattersScore(item("ad_new", 100)), 100);
  assert.equal(whyThisMattersScore(item("landing_page_offer_changed", 40)), 1040);
});

// ---------------------------------------------------------------------------
// Bullet 2 (collapse): churn never headlines; it is one counted line.
// ---------------------------------------------------------------------------

scenario("creative churn collapses into one counted line and never headlines", async () => {
  const { rerankDigestBrief, adChurnCountsLabel, adChurnFootnoteLine } = await import(
    "~/lib/digest-rerank"
  );

  const stream = mixedStream();
  // One new ad is actually testing variants — the footnote may name the split.
  stream[0] = item("ad_new", undefined, { variantCount: 4 });

  const rerank = rerankDigestBrief(stream);
  assert.equal(rerank.adChurnSummary.newCount, 7);
  assert.equal(rerank.adChurnSummary.retiredCount, 3);
  assert.equal(rerank.adChurnSummary.total, 10);
  assert.equal(rerank.adChurnSummary.maxNewVariantCount, 4);

  assert.equal(adChurnCountsLabel(rerank.adChurnSummary), "7 new creatives, 3 retired");
  assert.equal(
    adChurnFootnoteLine(rerank.adChurnSummary),
    "7 new creatives, 3 retired, as 4 versions — open the wall to see them.",
  );

  // No churn -> no line, so a quiet period renders nothing rather than an
  // empty footnote.
  assert.equal(adChurnCountsLabel(rerankDigestBrief([item("landing_page_offer_changed", 40)]).adChurnSummary), null);
  assert.equal(adChurnFootnoteLine(rerankDigestBrief([]).adChurnSummary), null);
});

// ---------------------------------------------------------------------------
// Bullet 2 (alerts): a bare ad_new / ad_inactive never fires an instant alert
// alone, whatever its importance score or sensitivity mode.
// ---------------------------------------------------------------------------

scenario("a bare ad_new never fires an instant alert alone, even at max importance", async () => {
  const { evaluateDeliveryPolicy } = await import("~/lib/delivery-policy.server");

  const decision = evaluateDeliveryPolicy({
    lane: "customer",
    event: watchEvent({ eventType: "ad_new", importanceScore: 100 }),
    workspaceConfig,
    watchlistConfig: null,
    // 15:30 UTC — outside the always-on 22:00-08:00 quiet-hours window, so the
    // assertion isolates the instant-rule gate from the quiet-hours deferral.
    now: T1,
  });
  assert.equal(
    decision.instantEligible,
    false,
    "creative churn is never instant-eligible on its own (infinite threshold)",
  );
  assert.equal(decision.digestEligible, true, "churn still reaches the digest footnote stream");
});

scenario("landing_page events clear the same importance gate the weighting feeds", async () => {
  const { evaluateDeliveryPolicy } = await import("~/lib/delivery-policy.server");

  const offer = evaluateDeliveryPolicy({
    lane: "customer",
    event: watchEvent({ eventType: "landing_page_offer_changed", importanceScore: 80 }),
    workspaceConfig,
    watchlistConfig: null,
    now: T1,
  });
  assert.equal(offer.instantEligible, true, "a confirmed offer change interrupts (1000+80 >= 1075)");

  const weakForm = evaluateDeliveryPolicy({
    lane: "customer",
    event: watchEvent({ eventType: "landing_page_form_changed", importanceScore: 20 }),
    workspaceConfig,
    watchlistConfig: null,
    now: T1,
  });
  assert.equal(
    weakForm.instantEligible,
    false,
    "the gate keeps its magnitude meaning: a low-importance form change stays quiet",
  );
});

// ---------------------------------------------------------------------------
// Bullet 1 (before/after + evidence): headline rows answer what changed and
// link to the stored evidence, from stored facts only.
// ---------------------------------------------------------------------------

scenario("headline rows carry before/after values and evidence capture times", async () => {
  const { readChangeBriefMark, readChangeBriefCaptureTimes } = await import(
    "~/lib/change-brief.server"
  );

  const metadata = {
    from: "Flat 30% off",
    to: "Flat 50% off",
    beforeCapturedAt: T0,
    capturedAt: T1,
  };
  assert.deepEqual(
    readChangeBriefMark({ eventType: "landing_page_offer_changed", metadata }),
    { from: "Flat 30% off", to: "Flat 50% off" },
    "both stored sides render as the before/after mark",
  );
  assert.deepEqual(readChangeBriefCaptureTimes(metadata), {
    beforeCapturedAt: T0,
    nowCapturedAt: T1,
  });

  // Honesty contract: the mark renders only when both sides exist and differ.
  assert.equal(
    readChangeBriefMark({ eventType: "landing_page_offer_changed", metadata: { from: "same", to: "same" } }),
    null,
  );
  assert.equal(
    readChangeBriefMark({ eventType: "landing_page_offer_changed", metadata: { to: "Flat 50% off" } }),
    null,
  );
  assert.equal(readChangeBriefCaptureTimes({ beforeCapturedAt: T1, capturedAt: T0 }), null,
    "capture times render only when stored and ordered",
  );
});

if (IS_VITEST) {
  scenario("delivered churn footnotes are one counted line per watchlist with an evidence deep link", async () => {
    const { adChurnFootnotesByWatchlist, digestItemDeepLink } = await import(
      "~/lib/digest-email.server"
    );

    const churn = [
      {
        eventType: "ad_new",
        proofStatus: "verified_proof",
        watchlistName: "Nykaa",
        watchlistId: "w-nykaa",
        metadata: {},
      },
      {
        eventType: "ad_inactive",
        proofStatus: "verified_proof",
        watchlistName: "Nykaa",
        watchlistId: "w-nykaa",
        metadata: {},
      },
      {
        eventType: "ad_new",
        proofStatus: "verified_proof",
        watchlistName: "Zappos",
        watchlistId: "w-zappos",
        metadata: {},
      },
    ];

    const footnotes = adChurnFootnotesByWatchlist(churn as never, "https://app.example/");
    assert.equal(footnotes.length, 2, "one counted line per watchlist, never one row per ping");
    const nykaa = footnotes.find((f) => f.watchlistName === "Nykaa");
    assert.ok(nykaa);
    assert.equal(nykaa.line, "1 new creative, 1 retired — open the ad wall.");
    assert.equal(nykaa.url, "https://app.example/app/watchlists?watchlist=w-nykaa");

    // WP-24: headline rows deep-link to the stored evidence (the watchlist
    // event row) when ids exist.
    assert.equal(
      digestItemDeepLink({ watchlistId: "w-nykaa", eventId: "wev-9" }, "https://app.example"),
      "https://app.example/app/watchlists?watchlist=w-nykaa&event=wev-9",
    );
    assert.equal(digestItemDeepLink({ watchlistId: "w-nykaa" }), null,
      "no fabricated link when the event id is missing",
    );
  });
}

// ---------------------------------------------------------------------------
// Bullet 3 (docs): the published weighting matches the shipped code.
// ---------------------------------------------------------------------------

scenario("the published docs match the shipped weighting", async () => {
  const { LANDING_PAGE_HEADLINE_EVENT_TYPES, AD_CHURN_EVENT_TYPES } = await import(
    "~/lib/digest-rerank"
  );
  const { whyThisMattersScore } = await import("~/lib/digest-rerank");

  const docPath = path.resolve(import.meta.dirname, "..", "docs", "digest-brief-ranking.md");
  assert.ok(fs.existsSync(docPath), "docs/digest-brief-ranking.md must exist (published weighting)");
  // Collapse markdown line-wrapping so phrase matches survive reflowing.
  const doc = fs.readFileSync(docPath, "utf8").replace(/\s+/g, " ");

  // The doc introduces the five headline types in descending weight order.
  const positions = LANDING_PAGE_HEADLINE_EVENT_TYPES.map((type) => doc.indexOf(type));
  assert.ok(
    positions.every((p) => p >= 0),
    "the doc must name every headline event type",
  );
  const weights = LANDING_PAGE_HEADLINE_EVENT_TYPES.map((type) =>
    whyThisMattersScore({ eventType: type }),
  );
  const byWeight = [...LANDING_PAGE_HEADLINE_EVENT_TYPES]
    .map((type, i) => ({ type, weight: weights[i], pos: positions[i] }))
    .sort((a, b) => b.weight - a.weight);
  const docOrder = [...byWeight].sort((a, b) => a.pos - b.pos).map((e) => e.type);
  assert.deepEqual(
    byWeight.map((e) => e.type),
    docOrder,
    "the doc presents the types in descending why-this-matters weight order",
  );

  for (const churn of AD_CHURN_EVENT_TYPES) {
    assert.ok(doc.includes(churn), `the doc must name ${churn}`);
  }
  assert.ok(
    doc.includes("no type weight") && doc.includes("never fire an instant alert alone"),
    "the doc must state that creative churn carries no weight and never alerts alone",
  );
});

// ---------------------------------------------------------------------------
// Metric: the >=60% landing_page_* headline target, measured by the shipped
// always-on guard on a 20-competitor cohort-shaped stream.
// ---------------------------------------------------------------------------

scenario("the headline-ratio guard measures the 60% BET 1 target on a 20-competitor cohort", async () => {
  const { measureDigestHeadline, headlineRatioSignal, DIGEST_HEADLINE_TARGET_RATIO } = await import(
    "~/lib/digest-headline-ratio"
  );
  assert.equal(DIGEST_HEADLINE_TARGET_RATIO, 0.6);

  // 20 competitors: 12 landing-page offer changes, 4 page changes, 4 new ads.
  const cohort = [
    ...Array.from({ length: 12 }, () => item("landing_page_offer_changed", 60)),
    ...Array.from({ length: 4 }, () => item("website_page_changed", 82)),
    ...Array.from({ length: 4 }, () => item("ad_new")),
  ];
  const day = measureDigestHeadline(cohort, "2026-09-11");
  assert.equal(day.headlineItemCount, 16, "churn is collapsed out of the measured headline stream");
  assert.equal(day.landingPageCount, 12);
  assert.equal(day.adChurnCount, 4);
  assert.equal(day.ratio, 0.75);
  assert.ok(day.ratio >= DIGEST_HEADLINE_TARGET_RATIO, "the cohort clears the 60% target");

  // A churn-only day is vacuous for the mix, not a breach: it stays out of the
  // rolling window mean.
  const churnOnlyDay = measureDigestHeadline(
    Array.from({ length: 8 }, () => item("ad_new")),
    "2026-09-12",
  );
  assert.equal(churnOnlyDay.headlineItemCount, 0);
  const signal = headlineRatioSignal([churnOnlyDay, day]);
  assert.equal(signal.sampledDays, 1);
  assert.equal(signal.rollingRatio, 0.75);
  assert.equal(signal.targetMet, true);
  assert.equal(signal.guardFired, false);

  // A regression that re-leaks churn into headlines drags the window under the
  // 50% floor and fires the guard.
  const breachDay = measureDigestHeadline(
    [
      ...Array.from({ length: 2 }, () => item("landing_page_offer_changed", 60)),
      ...Array.from({ length: 8 }, () => item("website_page_changed", 82)),
    ],
    "2026-09-13",
  );
  assert.equal(breachDay.ratio, 0.2);
  assert.equal(headlineRatioSignal([breachDay, day]).guardFired, true);
});

// ---------------------------------------------------------------------------
// Runner dispatch.
// ---------------------------------------------------------------------------

if (IS_VITEST) {
  const { describe, it } = await import("vitest");
  describe("monitoring brief ranking (BET 1, issue #3016)", () => {
    for (const s of scenarios) {
      it(s.name, async () => s.run());
    }
  });
} else {
  const { register } = await import("node:module");
  register("./monitoring-brief-ranking.resolve-hook.mjs", import.meta.url);
  const { test } = await import("node:test");
  for (const s of scenarios) {
    test(s.name, async () => s.run());
  }
}
