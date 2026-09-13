import { describe, expect, it } from "vitest";

import {
  SIGNUP_FIXTURE_PATTERNS,
  buildSignupsIntegrityQuery,
  evaluateSignupIntegrity,
  parseSignupEventRecords,
} from "../../scripts/weekly-business-metrics.mjs";

// Fixed, injected instants only — no wall-clock-reading assertions
// (fleet-ops #3243/#3246, #3212).
const NOW = new Date("2026-09-12T20:00:00.000Z");

/**
 * The #2908 read, replayed as a D1 mock: every #2908 identity pattern is
 * present (billing-canary email, the billing-canary guard id in its
 * BILLING_CANARY_EMAIL-override form, codex-qa-, codex-free-qa-, auth-QA —
 * one of them case-varied, because the canary lookup compares
 * lower(email)), plus real signups and a row outside the 30d window.
 */
const D1_MOCK_ROWS = [
  // #2908's newest row: the billing canary's dedicated identity.
  {
    id: "billing-canary-0509",
    email: "billing-canary@0509.internal",
    createdAt: "2026-09-11T09:16:00.000Z",
  },
  // Stands in for the BILLING_CANARY_EMAIL override: whatever the address,
  // ensureDedicatedBillingCanaryUser always binds BILLING_CANARY_USER_ID, so
  // only the guard id catches this row.
  {
    id: "billing-canary-0509",
    email: "billing-canary-staging@0509.internal",
    createdAt: "2026-09-10T10:00:00.000Z",
  },
  // #2908's "codex-qa-*" family, spelled with its real-world case variance.
  {
    id: "usr-codex-qa",
    email: "Codex-QA-1@Example.com",
    createdAt: "2026-09-08T09:00:00.000Z",
  },
  // #2908's "codex-free-qa-*" family.
  {
    id: "usr-codex-free-qa",
    email: "codex-free-qa-7@0509.internal",
    createdAt: "2026-09-02T09:00:00.000Z",
  },
  // #2908's "auth-QA" family (bare in #2908; emails carry a domain).
  {
    id: "usr-auth-qa",
    email: "auth-QA@example.com",
    createdAt: "2026-08-30T09:00:00.000Z",
  },
  // The issue's undecidable row: 2026-09-11T21:35:47Z, fixture or first real
  // signup. The meter must decide it: no fixture pattern matches, and a
  // signup_completed event follows 1.6s behind.
  {
    id: "usr-real-1",
    email: "first-real@example.com",
    createdAt: "2026-09-11T21:35:47.356Z",
  },
  // Inside the 7d retention window but without a consumable event: suspect.
  {
    id: "usr-real-2",
    email: "second-real@example.com",
    createdAt: "2026-09-11T10:00:00.000Z",
  },
  // Outside the 7d Workers Logs retention: cannot be cross-checked, so it is
  // disclosed as uncheckable rather than suspected.
  {
    id: "usr-real-3",
    email: "third-real@example.com",
    createdAt: "2026-08-31T12:00:00.000Z",
  },
  // A 31d-old fixture: outside the baseline window, so outside rows_total.
  {
    id: "usr-old-fixture",
    email: "codex-qa-0@0509.internal",
    createdAt: "2026-08-12T09:00:00.000Z",
  },
];

const EVENT_BUNDLE = {
  records: [
    // Consumed by usr-real-1 (1.644s away).
    { operation: "funnel_signup_completed", timestamp: "2026-09-11T21:35:49.000Z" },
    // Two hours from its nearest surviving row: never consumable.
    { operation: "funnel_signup_completed", timestamp: "2026-09-11T12:00:00.000Z" },
    // Wrong operation: disclosed as non_signup_records, never matched.
    { operation: "funnel_home_view", timestamp: "2026-09-11T21:35:48.000Z" },
    // Right operation, unreadable timestamp: disclosed, never matched.
    { operation: "funnel_signup_completed", timestamp: "not-a-date" },
  ],
  unparseableLines: 0,
};

describe("weekly-business-metrics signup integrity (issue #3321)", () => {
  it("counts every #2908 fixture family out and keeps the arithmetic honest", () => {
    const result = evaluateSignupIntegrity(D1_MOCK_ROWS, NOW, null);

    expect(result.rows_total).toBe(8);
    expect(result.excluded_fixtures).toBe(5);
    expect(result.signups_30d).toBe(3);
    expect(result.signups_7d).toBe(2);
    // signups_30d + excluded_fixtures = rows_total, by construction: the
    // packet can re-derive the meter from its own output.
    expect(
      (result.signups_30d as number) + (result.excluded_fixtures as number),
    ).toBe(result.rows_total);
    // The by-pattern breakdown sums to the excluded count — no pattern
    // counted a row twice, no row slipped through unnamed.
    const byPattern = result.excluded_fixtures_by_pattern as Record<string, number>;
    expect(byPattern).toEqual({
      "billing-canary@0509.internal": 1,
      "billing-canary-0509": 1,
      "codex-qa-": 1,
      "codex-free-qa-": 1,
      "auth-QA": 1,
    });
    expect(Object.values(byPattern).reduce((a, b) => a + b, 0)).toBe(
      result.excluded_fixtures,
    );
    // The applied pattern list is echoed, so the output always names the
    // exclusion rules that produced it.
    expect(result.fixture_patterns).toBe(SIGNUP_FIXTURE_PATTERNS);
    expect(SIGNUP_FIXTURE_PATTERNS).toHaveLength(5);
  });

  it("lists surviving rows without a consumable signup_completed event as suspect, not silently counted", () => {
    const result = evaluateSignupIntegrity(D1_MOCK_ROWS, NOW, EVENT_BUNDLE);
    const crossCheck = result.event_cross_check as Record<string, unknown>;

    expect(crossCheck.evaluated).toBe(true);
    expect(crossCheck.retention_days).toBe(7);
    expect(crossCheck.match_window_minutes).toBe(30);
    expect(crossCheck.signup_completed_events).toBe(2);
    expect(crossCheck.non_signup_records).toBe(1);
    expect(crossCheck.unreadable_event_records).toBe(1);
    expect(crossCheck.rows_within_retention).toBe(2);
    expect(crossCheck.matched).toBe(1);
    expect(crossCheck.rows_outside_retention).toBe(1);
    expect(crossCheck.suspect).toEqual([
      {
        email: "second-real@example.com",
        createdAt: "2026-09-11T10:00:00.000Z",
        state: "no_event_in_window",
      },
    ]);
    // Counted, but never silently: the suspect row is inside signups_30d AND
    // named in the disclosure.
    expect(result.signups_30d).toBe(3);
  });

  it("pairs rows and events one-to-one — the greedy nearest match never double-spends an event", () => {
    const base = "2026-09-11T21:35:00.000Z";
    const later = "2026-09-11T21:36:00.000Z";
    const rows = [
      { id: "a", email: "a-real@example.com", createdAt: base },
      { id: "b", email: "b-real@example.com", createdAt: later },
      // Excluded before matching, so it can never steal a real row's event:
      // the canary's row has no funnel event of its own.
      {
        id: "x",
        email: "BILLING-CANARY@0509.INTERNAL",
        createdAt: "2026-09-11T21:36:30.000Z",
      },
    ];

    // One event, two candidates: exactly one consumable pairing; the earlier
    // row wins the greedy pick and the other is the named suspect.
    const oneEvent = evaluateSignupIntegrity(rows, NOW, {
      records: [{ operation: "funnel_signup_completed", timestamp: "2026-09-11T21:35:30.000Z" }],
      unparseableLines: 0,
    });
    expect((oneEvent.event_cross_check as Record<string, unknown>).matched).toBe(1);
    expect((oneEvent.event_cross_check as Record<string, unknown>).suspect).toEqual([
      { email: "b-real@example.com", createdAt: later, state: "no_event_in_window" },
    ]);

    // Two events, two candidates: both corroborated, nobody suspect — and the
    // fixture stayed out of the pairing entirely.
    const twoEvents = evaluateSignupIntegrity(rows, NOW, {
      records: [
        { operation: "funnel_signup_completed", timestamp: "2026-09-11T21:35:30.000Z" },
        { operation: "funnel_signup_completed", timestamp: "2026-09-11T21:36:01.000Z" },
      ],
      unparseableLines: 0,
    });
    expect((twoEvents.event_cross_check as Record<string, unknown>).matched).toBe(2);
    expect((twoEvents.event_cross_check as Record<string, unknown>).suspect).toEqual([]);
    expect((twoEvents.event_cross_check as Record<string, unknown>).signup_completed_events).toBe(2);
    expect(twoEvents.excluded_fixtures).toBe(1);
  });

  it("discloses everything when events are supplied but the log has none", () => {
    const result = evaluateSignupIntegrity(D1_MOCK_ROWS.slice(5, 6), NOW, {
      records: [],
      unparseableLines: 3,
    });
    const crossCheck = result.event_cross_check as Record<string, unknown>;

    expect(crossCheck.evaluated).toBe(true);
    expect(crossCheck.signup_completed_events).toBe(0);
    expect(crossCheck.unparseable_event_lines).toBe(3);
    expect(crossCheck.rows_within_retention).toBe(1);
    expect(crossCheck.matched).toBe(0);
    expect(crossCheck.suspect).toEqual([
      {
        email: "first-real@example.com",
        createdAt: "2026-09-11T21:35:47.356Z",
        state: "no_event_in_window",
      },
    ]);
  });

  it("reports evaluated:false — and suspects nobody — when no event bundle was supplied", () => {
    const result = evaluateSignupIntegrity(D1_MOCK_ROWS, NOW, null);
    const crossCheck = result.event_cross_check as Record<string, unknown>;

    // The bare `--json` run: the counting contract holds, the cross-check
    // simply did not happen and says so.
    expect(crossCheck.evaluated).toBe(false);
    expect(crossCheck.signup_completed_events).toBe(0);
    expect(crossCheck.matched).toBe(0);
    expect(crossCheck.suspect).toEqual([]);
    expect(crossCheck.rows_outside_retention).toBe(0);
    expect(result.signups_30d).toBe(3);
  });

  it("reads the meter as one SELECT over the baseline window", () => {
    const sql = buildSignupsIntegrityQuery(NOW);
    expect(sql).toContain('FROM "user"');
    expect(sql).toContain("SELECT id, email, createdAt");
    expect(sql).toContain("WHERE createdAt >= '2026-08-13T20:00:00.000Z'");
    expect(sql).toContain("ORDER BY createdAt DESC");
    expect(sql).toContain("LIMIT 1000");
    // Issue acceptance 5: read-only. If a write ever sneaks into this
    // string, the "read-only SELECTs only" promise is dead.
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|DROP|CREATE|ALTER/);
  });

  it("parseSignupEventRecords skips blanks and counts junk lines", () => {
    const parsed = parseSignupEventRecords(
      [
        "",
        '{"operation":"funnel_signup_completed","timestamp":"2026-09-11T21:35:49.000Z"}',
        "   ",
        "not-json",
        "123",
        '{"operation":"funnel_signup_completed","timestamp":"2026-09-11T21:36:00.000Z"}',
      ].join("\n"),
    );
    expect(parsed.records).toHaveLength(2);
    expect(parsed.unparseableLines).toBe(2);
  });
});
