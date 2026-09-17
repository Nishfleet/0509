import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  buildSignalSql,
  buildSnapshot,
  fetchIssues,
  marketSignalFailureMessage,
  parseD1Response,
  summarizeIssues,
  SYNTHETIC_USER_PATTERNS,
  SYNTHETIC_WATCHLIST_IDS,
} from "../scripts/market-signal-snapshot.mjs";

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
    const snapshot = buildSnapshot({
      d1: d1Payload,
      issues: [{
        number: 9,
        title: "customer@example.com",
        state: "OPEN",
        labels: [],
        createdAt: "2026-08-02T10:00:00Z",
        closedAt: null,
        url: "https://github.test/9",
      }],
      generatedAt: new Date("2026-08-02T12:00:00Z"),
    });
    expect(snapshot.sourceHealth).toEqual({ cloudflareD1: "ok", githubIssues: "ok" });
    expect(snapshot.privacy).toContain("no customer identity or message body");
    expect(JSON.stringify(snapshot)).not.toContain("customer@example.com");
    expect(snapshot.windows.recent24h).toEqual({
      start: "2026-08-01T12:00:00.000Z",
      end: "2026-08-02T12:00:00.000Z",
    });
  });

  it("degrades to a truthful unavailable section when issue reads are denied", () => {
    const snapshot = buildSnapshot({
      d1: d1Payload,
      issues: { unavailable: true },
      generatedAt: new Date("2026-08-02T12:00:00Z"),
    });
    expect(snapshot.github).toEqual({ unavailable: true });
    expect(snapshot.sourceHealth).toEqual({ cloudflareD1: "ok", githubIssues: "unavailable" });
    expect(snapshot.product).toBeDefined();
    expect(snapshot.generatedAt).toBe("2026-08-02T12:00:00.000Z");
  });

  it("covers every synthetic-identity family named in the issue acceptance", () => {
    expect(SYNTHETIC_USER_PATTERNS).toEqual(
      expect.arrayContaining([
        { field: "id", value: "billing-canary-0509", match: "exact" },
        { field: "email", value: "billing-canary@0509.internal", match: "exact" },
        { field: "id", value: "launch-readiness-canary-owner", match: "exact" },
        { field: "email", value: "@0509.internal", match: "suffix" },
        { field: "email", value: "bet1-3322-", match: "prefix" },
        { field: "email", value: "codex-qa-", match: "prefix" },
      ]),
    );
    expect(SYNTHETIC_WATCHLIST_IDS).toContain("launch-readiness-canary-watchlist");
    const sql = buildSignalSql(new Date("2026-09-14T12:00:00.000Z"));
    for (const needle of [
      "bet1-3322-",
      "@0509.internal",
      "launch-readiness-canary-owner",
      "launch-readiness-canary-watchlist",
      "synthetic_users_7d",
      "synthetic_watchlists_7d",
    ]) {
      expect(sql).toContain(needle);
    }
  });

  /**
   * The issue's verify step, run as a seeded fixture: the snapshot SQL sees
   * canary users, a BET-1 burst signup, a canary-owned watchlist, and a
   * canary watchlist row owned by a *real* account — and the customer-facing
   * counts still only count the organic rows.
   */
  it("keeps fleet-synthetic rows out of every customer-facing count", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT, createdAt TEXT);
        CREATE TABLE watchlist (id TEXT PRIMARY KEY, user_id TEXT, is_active INTEGER, created_at TEXT);
        CREATE TABLE watchlist_run (watchlist_id TEXT, status TEXT, created_at TEXT);
        CREATE TABLE watch_event (watchlist_id TEXT, created_at TEXT);
        CREATE TABLE digest_run (id TEXT PRIMARY KEY, user_id TEXT);
        CREATE TABLE digest_delivery (digest_run_id TEXT, status TEXT, created_at TEXT);
        CREATE TABLE support_case (user_id TEXT, status TEXT, category TEXT, created_at TEXT);
        CREATE TABLE dodo_webhook_event (user_id TEXT, event_type TEXT, outcome TEXT, received_at TEXT);
        CREATE TABLE user_plan (user_id TEXT PRIMARY KEY, plan TEXT, dodo_status TEXT);
      `);
      const users = db.prepare("INSERT INTO user (id, email, createdAt) VALUES (?, ?, ?)");
      // generatedAt = 2026-09-14T12:00Z → recent_24h starts 09-13T12:00Z,
      // recent_7d starts 09-07T12:00Z, previous_7d ends 09-07T12:00Z.
      const userRows = [
        ["organic-1", "customer@example.com", "2026-09-14T06:00:00.000Z"],
        ["organic-2", "other@example.org", "2026-09-10T00:00:00.000Z"],
        ["organic-old", "old@example.net", "2026-08-20T00:00:00.000Z"],
        ["organic-prev", "prev@example.net", "2026-09-03T00:00:00.000Z"],
        ["billing-canary-0509", "billing-canary@0509.internal", "2026-09-14T08:00:00.000Z"],
        // id rule only: the email deliberately looks like a normal mailbox.
        ["launch-readiness-canary-owner", "canary.owner@0509.io", "2026-09-14T09:00:00.000Z"],
        ["bet1-3322-07", "bet1-3322-07@0509.io", "2026-09-14T10:00:00.000Z"],
        ["qa-1", "codex-qa-1@0509.internal", "2026-09-11T00:00:00.000Z"],
        // prefix rule on a non-internal domain.
        ["qa-2", "auth-QA-probe@example.net", "2026-09-13T20:00:00.000Z"],
        ["qa-3", "codex-free-qa-9@0509.internal", "2026-09-02T00:00:00.000Z"],
      ];
      for (const row of userRows) users.run(...row);

      const watchlists = db.prepare(
        "INSERT INTO watchlist (id, user_id, is_active, created_at) VALUES (?, ?, ?, ?)",
      );
      const watchlistRows = [
        ["wl-organic", "organic-1", 1, "2026-09-12T00:00:00.000Z"],
        // The launch canary watchlist owned by a REAL account: only the
        // id rule can keep it out — the prod shape (owner ?? CANARY_USER_ID).
        ["launch-readiness-canary-watchlist", "organic-1", 1, "2026-09-11T00:00:00.000Z"],
        ["wl-canary-owned", "billing-canary-0509", 1, "2026-09-13T00:00:00.000Z"],
        ["wl-prev", "organic-2", 0, "2026-09-02T00:00:00.000Z"],
        ["wl-synth-prev", "bet1-3322-07", 1, "2026-09-03T00:00:00.000Z"],
      ];
      for (const row of watchlistRows) watchlists.run(...row);

      const runs = db.prepare("INSERT INTO watchlist_run (watchlist_id, status, created_at) VALUES (?, ?, ?)");
      for (const row of [
        ["wl-organic", "succeeded", "2026-09-14T06:00:00.000Z"],
        ["wl-organic", "failed", "2026-09-14T09:00:00.000Z"],
        ["launch-readiness-canary-watchlist", "succeeded", "2026-09-14T07:00:00.000Z"],
        ["wl-canary-owned", "failed", "2026-09-14T08:00:00.000Z"],
      ]) runs.run(...row);

      const events = db.prepare("INSERT INTO watch_event (watchlist_id, created_at) VALUES (?, ?)");
      for (const row of [
        ["wl-organic", "2026-09-14T06:30:00.000Z"],
        ["launch-readiness-canary-watchlist", "2026-09-14T07:30:00.000Z"],
      ]) events.run(...row);

      db.prepare("INSERT INTO digest_run (id, user_id) VALUES (?, ?)").run("dr-organic", "organic-1");
      db.prepare("INSERT INTO digest_run (id, user_id) VALUES (?, ?)").run("dr-canary", "billing-canary-0509");
      const deliveries = db.prepare(
        "INSERT INTO digest_delivery (digest_run_id, status, created_at) VALUES (?, ?, ?)",
      );
      for (const row of [
        ["dr-organic", "sent", "2026-09-14T05:00:00.000Z"],
        ["dr-canary", "sent", "2026-09-14T05:30:00.000Z"],
        ["dr-canary", "failed", "2026-09-14T05:45:00.000Z"],
      ]) deliveries.run(...row);

      const cases = db.prepare(
        "INSERT INTO support_case (user_id, status, category, created_at) VALUES (?, ?, ?, ?)",
      );
      for (const row of [
        ["organic-1", "open", "delivery", "2026-09-13T00:00:00.000Z"],
        ["bet1-3322-07", "open", "account", "2026-09-14T00:00:00.000Z"],
      ]) cases.run(...row);

      const webhooks = db.prepare(
        "INSERT INTO dodo_webhook_event (user_id, event_type, outcome, received_at) VALUES (?, ?, ?, ?)",
      );
      for (const row of [
        [null, "subscription.active", "processed", "2026-09-14T04:00:00.000Z"],
        [null, "payment.failed", "failed", "2026-09-14T04:30:00.000Z"],
        ["billing-canary-0509", "payment.failed", "failed", "2026-09-14T05:00:00.000Z"],
        [null, "billing.canary.checkout", "failed", "2026-09-14T05:30:00.000Z"],
      ]) webhooks.run(...row);

      const plans = db.prepare("INSERT INTO user_plan (user_id, plan, dodo_status) VALUES (?, ?, ?)");
      for (const row of [
        ["organic-1", "starter", "active"],
        ["organic-2", "free", null],
        ["billing-canary-0509", "agency", "active"],
      ]) plans.run(...row);

      const sql = buildSignalSql(new Date("2026-09-14T12:00:00.000Z"));
      const row = db.prepare(sql).get() as Record<string, unknown>;
      const product = parseD1Response([{ success: true, results: [row] }]) as Record<string, unknown>;

      expect(product).toMatchObject({
        users_total: 4,
        users_24h: 1,
        users_previous_24h: 0,
        users_7d: 2,
        users_previous_7d: 1,
        synthetic_users_total: 6,
        synthetic_users_24h: 4,
        synthetic_users_7d: 5,
        active_watchlists: 1,
        watchlists_7d: 1,
        watchlists_previous_7d: 1,
        synthetic_active_watchlists: 3,
        synthetic_watchlists_7d: 2,
        runs_24h: 2,
        runs_previous_24h: 0,
        failed_runs_24h: 1,
        events_24h: 1,
        events_previous_24h: 0,
        digests_sent_24h: 1,
        digests_failed_24h: 0,
        support_open: 1,
        support_7d: 1,
        support_previous_7d: 0,
        // billing_events_24h deliberately stays a total-volume metric
        // (issue #1942: canary traffic counts toward pipeline volume; only
        // the problem metric is filtered — by event_type AND, now, owner).
        billing_events_24h: 4,
        billing_problem_events_24h: 1,
        paid_accounts: 1,
        planMix: { starter: 1, free: 1 },
        supportCategories7d: { delivery: 1 },
        billingEventTypes7d: {
          "subscription.active": 1,
          "payment.failed": 2,
          "billing.canary.checkout": 1,
        },
      });
    } finally {
      db.close();
    }
  });

  it("binds every query window to the snapshot timestamp", () => {
    const sql = buildSignalSql(new Date("2026-08-02T12:00:00Z"));
    expect(sql).toContain("2026-08-02T12:00:00.000Z");
    expect(sql).not.toContain("datetime('now')");
  });

  it("classifies the expired-credentials wrangler failure as an auth-required diagnostic", () => {
    const message = marketSignalFailureMessage(
      "In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable for wrangler to work.",
    );
    expect(message).toContain("market_signal_auth_required");
    expect(message).toContain("wrangler login");
    expect(message).toContain("CLOUDFLARE_API_TOKEN");
    expect(message).not.toContain("market_signal_snapshot_failed");
  });

  it("classifies the expired-OAuth-session wrangler text as auth-required too", () => {
    const message = marketSignalFailureMessage(
      "Not logged in. Your auth token has expired and could not be refreshed, and the environment is non-interactive.",
    );
    expect(message).toContain("market_signal_auth_required");
  });

  it("keeps non-auth failures on the existing failure tag", () => {
    const message = marketSignalFailureMessage("D1 signal query returned no successful result.");
    expect(message).toBe("market_signal_snapshot_failed: D1 signal query returned no successful result.");
  });

  it("reports the JSON error payload wrangler prints under --json as auth-required", () => {
    expect(() =>
      parseD1Response({
        error: {
          text: "In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable for wrangler to work.",
        },
      }),
    ).toThrow(/market_signal_auth_required/);
  });

  it("classifies an already-classified message unchanged", () => {
    const classified = marketSignalFailureMessage("market_signal_auth_required: already explained");
    expect(classified).toBe("market_signal_auth_required: already explained");
  });

  it("does not classify a CLOUDFLARE_API_TOKEN mention in wrangler 9106 as missing-token", () => {
    const message = marketSignalFailureMessage(
      "Failed to automatically retrieve account IDs for the logged in user.\n" +
        "You may have incorrect permissions on your API token, or an environment variable such as CLOUDFLARE_API_TOKEN, CLOUDFLARE_API_KEY, or CLOUDFLARE_EMAIL may be set to an invalid value.",
    );
    expect(message).toMatch(/^market_signal_snapshot_failed:/);
    expect(message).toContain("incorrect permissions");
    expect(message).not.toContain("market_signal_auth_required");
  });

  it("does not classify missing-account-id non-interactive text as missing-token", () => {
    const message = marketSignalFailureMessage(
      "In a non-interactive environment, it is mandatory to specify an account ID, either by assigning its value to CLOUDFLARE_ACCOUNT_ID, or as `account_id` in your wrangler.jsonc file.",
    );
    expect(message).toMatch(/^market_signal_snapshot_failed:/);
    expect(message).not.toContain("market_signal_auth_required");
  });

  it("classifies wrangler no-credentials-non-interactive body as auth-required", () => {
    const message = marketSignalFailureMessage(
      "Could not authenticate because no credentials were found and the environment is non-interactive. Set a CLOUDFLARE_API_TOKEN environment variable or run `wrangler login` in an interactive terminal first.",
    );
    expect(message).toContain("market_signal_auth_required");
  });

  it("prints raw command output before classifying a wrangler failure", () => {
    const source = readFileSync("scripts/market-signal-snapshot.mjs", "utf8");
    expect(source).toContain("market_signal_command_raw:");
    expect(source).toContain("failure.stderr");
  });
});
