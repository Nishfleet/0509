import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildSignalSql,
  buildSnapshot,
  fetchIssues,
  marketSignalFailureMessage,
  parseD1Response,
  summarizeIssues,
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
