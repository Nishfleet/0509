import { describe, expect, it } from "vitest";

import { buildSnapshot, parseD1Response, summarizeIssues } from "../scripts/market-signal-snapshot.mjs";

const d1Payload = [
  {
    success: true,
    results: [
      {
        users_total: 15,
        users_24h: 1,
        users_previous_24h: 0,
        plan_mix_json: '{"free":12,"starter":3}',
        support_categories_json: '{"delivery":2}',
        billing_event_types_json: '{"subscription.active":1}',
      },
    ],
  },
];

describe("market signal snapshot", () => {
  it("parses aggregate maps without retaining transport fields", () => {
    expect(parseD1Response(d1Payload)).toEqual({
      users_total: 15,
      users_24h: 1,
      users_previous_24h: 0,
      planMix: { free: 12, starter: 3 },
      supportCategories7d: { delivery: 2 },
      billingEventTypes7d: { "subscription.active": 1 },
    });
  });

  it("compares equal seven-day GitHub issue windows", () => {
    const now = new Date("2026-08-02T12:00:00.000Z");
    const issues = [
      { number: 3, title: "Current", state: "OPEN", labels: [], createdAt: "2026-08-01T00:00:00Z", closedAt: null, url: "https://github.test/3" },
      { number: 2, title: "Closed", state: "CLOSED", labels: [{ name: "bug" }], createdAt: "2026-07-30T00:00:00Z", closedAt: "2026-08-01T00:00:00Z", url: "https://github.test/2" },
      { number: 1, title: "Previous", state: "OPEN", labels: [], createdAt: "2026-07-22T00:00:00Z", closedAt: null, url: "https://github.test/1" },
    ];

    expect(summarizeIssues(issues, now)).toMatchObject({
      openTotal: 2,
      opened7d: 2,
      openedPrevious7d: 1,
      closed7d: 1,
      recent: [{ number: 3 }, { number: 2 }, { number: 1 }],
    });
  });

  it("labels the snapshot as aggregate-only customer-safe evidence", () => {
    const snapshot = buildSnapshot({ d1: d1Payload, issues: [], generatedAt: new Date("2026-08-02T12:00:00Z") });
    expect(snapshot.sourceHealth).toEqual({ cloudflareD1: "ok", githubIssues: "ok" });
    expect(snapshot.privacy).toContain("no customer identity or message body");
    expect(JSON.stringify(snapshot)).not.toContain("customer@example.com");
  });
});
