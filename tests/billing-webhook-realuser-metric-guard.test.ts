import { describe, expect, it } from "vitest";

import { buildSignalSql } from "../scripts/market-signal-snapshot.mjs";

// Prevention mechanism for issue #1942: the daily market-signal
// `billing_problem_events_24h` metric must report only real-user payment
// problems, never internal billing-canary replays. The canary rows carry
// event_type 'billing.canary.lock' (and the sibling 'billing.canary.*'
// family) and are driven by the internal canary route, so a nonzero problem
// count from them is expected noise, not a broken paywall. This canary pins
// the exclusion clause in the metric query so the query semantics cannot
// silently regress and start false-alarming the daily digest on internal
// replays again.
//
// The exclusion is asserted structurally against the generated SQL (the
// metric is computed by a D1 query, not in JS), so the test reads the exact
// clause that runs in production. A future edit that drops the canary
// exclusion fails this test and surfaces on main.
const CANARY_EXCLUSION = "event_type NOT LIKE 'billing.canary.%'";

describe("billing-webhook real-user problem metric", () => {
  it("excludes billing-canary event types from the daily problem metric", () => {
    const sql = buildSignalSql(new Date("2026-09-07T12:00:00Z"));

    // The problem metric must count only real-user payment problems. The
    // canary-exclusion clause must be present in the same SELECT that defines
    // billing_problem_events_24h.
    const problemMetric = sql.match(/[^\n]*AS billing_problem_events_24h/);
    expect(problemMetric).not.toBeNull();
    expect(problemMetric![0]).toContain(CANARY_EXCLUSION);
  });

  it("keeps the canary-exclusion scoped to the problem metric, not the total event count", () => {
    const sql = buildSignalSql(new Date("2026-09-07T12:00:00Z"));

    // The total billing_events_24h metric counts every webhook event (canary
    // included) so the digest still sees overall volume; only the problem
    // metric is canary-filtered. Asserting the total metric does NOT carry the
    // exclusion pins that the two metrics stay distinct.
    const totalMetric = sql.match(/[^\n]*AS billing_events_24h/);
    expect(totalMetric).not.toBeNull();
    expect(totalMetric![0]).not.toContain(CANARY_EXCLUSION);
  });
});
