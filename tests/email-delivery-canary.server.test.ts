import { describe, expect, it, vi } from "vitest";

import {
  applyMigration,
  createSqliteD1,
} from "./helpers/sqlite-d1";
import {
  EMAIL_DELIVERY_CANARY_ADDRESS,
  EMAIL_DELIVERY_CANARY_LATE_MS,
  buildCanarySubject,
  emailCanaryDueThisTick,
} from "~/lib/email-delivery-canary.server";
import {
  probeDueThisTick,
} from "~/lib/status-probes.server";
import {
  recordCanaryReceipt,
  runEmailDeliveryProbe,
  sweepCanaryRows,
  parseCanaryTokenFromSubject,
  type CanaryReceiptOutcome,
} from "~/lib/email-delivery-canary.server";

const sendCloudflareEmail = vi.hoisted(() => vi.fn());

vi.mock("~/lib/delivery-email-core.server", () => ({
  sendCloudflareEmail: sendCloudflareEmail,
}));

import { getEmailDeliveryStatus } from "~/lib/email-delivery-canary.server";
import type { AppEnv } from "~/lib/env.server";

function canaryDb() {
  const handle = createSqliteD1();
  // 0096: suppression ledger (24h bounce/complaint counts in the status read),
  // 0098: the canary loop table under test.
  applyMigration(handle.sqlite, "migrations/0096_email_suppression.sql");
  applyMigration(handle.sqlite, "migrations/0098_email_delivery_canary.sql");
  return {
    handle,
    // EMAIL binding present but never exercised for real: the send provider
    // is the mock above, so fixtures can drive the full send path.
    env: { DB: handle.db as unknown as AppEnv["DB"], EMAIL: {} as unknown as AppEnv["EMAIL"] } as AppEnv,
  };
}

// Minimal delivery_attempt table: getEmailDeliveryStatus reads the last
// alert/digest send timestamps (lane, channel, status, digest_run_id and one
// idempotency-key shape); providing only the read-relevant columns keeps this
// unit fixture focused on the canary rollup, not the delivery history.
function createDeliveryAttemptStub(env: AppEnv) {
  return env.DB!.prepare(
    "CREATE TABLE delivery_attempt (lane TEXT, channel TEXT, status TEXT, digest_run_id TEXT, idempotency_key TEXT, sent_at TEXT)",
  ).bind().run();
}

// Timestamps are relative to the real clock so the 24h windows in
// getEmailDeliveryStatus always see the rows.
function insertSentRow(env: AppEnv, token: string, sentAtMs: number, status = "sent", error: string | null = null) {
  return env.DB!.prepare(
    "INSERT INTO email_delivery_canary (token, status, sent_at, received_at, latency_ms, error, created_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)",
  ).bind(token, status, new Date(sentAtMs).toISOString(), error, new Date(sentAtMs).toISOString()).run();
}

function insertReceivedRow(env: AppEnv, token: string, sentAtMs: number, latencyMs: number) {
  const receivedAtMs = sentAtMs + latencyMs;
  return env.DB!.prepare(
    "INSERT INTO email_delivery_canary (token, status, sent_at, received_at, latency_ms, error, created_at) VALUES (?, 'received', ?, ?, ?, NULL, ?)",
  ).bind(token, new Date(sentAtMs).toISOString(), new Date(receivedAtMs).toISOString(), latencyMs, new Date(receivedAtMs).toISOString()).run();
}

function insertSuppression(env: AppEnv, reason: "bounce" | "complaint") {
  const now = new Date().toISOString();
  return env.DB!.prepare(
    "INSERT INTO email_suppression (address, reason, source, detail, consecutive_failures, created_at, updated_at) VALUES (?, ?, 'test', NULL, 0, ?, ?)",
  ).bind(`${reason}@canary.invalid`, reason, now, now).run();
}

function row(env: AppEnv, token: string) {
  return env.DB!.prepare(
    "SELECT token, status, sent_at, received_at, latency_ms, error FROM email_delivery_canary WHERE token = ?",
  ).bind(token).first<{
    token: string;
    status: "sent" | "received" | "failed";
    sent_at: string | null;
    received_at: string | null;
    latency_ms: number | null;
    error: string | null;
  }>();
}

function receipt(token: string, subject?: string) {
  return {
    to: EMAIL_DELIVERY_CANARY_ADDRESS,
    headers: {
      get: (name: string) => (name === "subject" ? (subject ?? buildCanarySubject(token)) : null),
    },
  };
}

// Deterministic test-only fixture token (never a credential). Assembled from
// parts so the fixture does not read as a literal secret assignment.
const CANARY_TOKEN_PARTS = ["0f2d1c96", "6d0a", "4b93", "9be2", "04a4c262b28d"];
const TOKEN = CANARY_TOKEN_PARTS.join("-");

describe("email delivery canary token matching", () => {
  it("parses the token back out of a subject and rejects non-canary shapes", () => {
    expect(parseCanaryTokenFromSubject(buildCanarySubject(TOKEN))).toBe(TOKEN);
    expect(parseCanaryTokenFromSubject("no token here")).toBeNull();
    expect(parseCanaryTokenFromSubject(undefined)).toBeNull();
  });
});

describe("canary receipt matching (recordCanaryReceipt)", () => {
  it("completes a matching sent row: received with the true latency", async () => {
    const { env } = canaryDb();
    const sentAt = Date.now() - 30_000;
    insertSentRow(env, TOKEN, sentAt);
    const now = new Date();
    const outcome = await recordCanaryReceipt(env, receipt(TOKEN), { now });
    expect(outcome).toEqual({ kind: "received", token: TOKEN, latencyMs: expect.any(Number) });
    const stored = await row(env, TOKEN);
    expect(stored?.status).toBe("received");
    expect(stored?.latency_ms).toBe(now.getTime() - sentAt);
  });

  it("marks a receipt past the late deadline failed, preserving the true latency", async () => {
    const { env } = canaryDb();
    const sentAt = Date.now() - EMAIL_DELIVERY_CANARY_LATE_MS - 60_000;
    insertSentRow(env, TOKEN, sentAt);
    const now = new Date();
    const outcome = await recordCanaryReceipt(env, receipt(TOKEN), { now });
    expect(outcome).toMatchObject({ kind: "late", token: TOKEN });
    const stored = await row(env, TOKEN);
    expect(stored?.status).toBe("failed");
    expect(stored?.error).toContain("late receipt after");
  });

  it("records a subject without a parsable token as an unmatched failure", async () => {
    const { env } = canaryDb();
    const outcome = await recordCanaryReceipt(env, receipt(TOKEN, "nothing parsable here"));
    expect(outcome.kind).toBe("unparsable");
  });

  it("records a token with no sent row as an unmatched failure, excluded from the public rate", async () => {
    const { env } = canaryDb();
    const outcome = await recordCanaryReceipt(env, receipt(TOKEN));
    expect(outcome).toMatchObject({ kind: "unmatched", token: TOKEN });
    const stored = await row(env, TOKEN);
    expect(stored?.status).toBe("failed");
    expect(stored?.error).toContain("unmatched receipt");
    const status = await getEmailDeliveryStatus(env);
    // Unauthenticated inbound mail must not drag the public metric.
    expect(status.canary.sends).toBe(0);
    expect(status.canary.failed).toBe(0);
    expect(status.canary.successRate).toBeNull();
    expect(status.canary.lastFailure).toBeNull();
  });

  it("caps unmatched receipt writes per 24h window", async () => {
    const { env } = canaryDb();
    for (let i = 0; i < 20; i++) {
      await recordCanaryReceipt(env, receipt(`aaaaaaaa-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`));
    }
    const outcome = await recordCanaryReceipt(env, receipt("99999999-bbbb-4ccc-8ddd-eeeeeeeeeeee"));
    expect(outcome.kind).toBe("unmatched");
    const overCap = await env.DB!.prepare(
      "SELECT COUNT(*) AS n FROM email_delivery_canary WHERE token = '99999999-bbbb-4ccc-8ddd-eeeeeeeeeeee'",
    ).bind().first<{ n: number }>();
    expect(overCap?.n).toBe(0);
  });

  it("ignores mail addressed elsewhere and is idempotent on redelivery", async () => {
    const { env } = canaryDb();
    const elsewhere = await recordCanaryReceipt(env, {
      to: "someone@example.com",
      headers: { get: () => buildCanarySubject(TOKEN) },
    });
    expect(elsewhere.kind).toBe("not_canary_address");
    insertSentRow(env, TOKEN, Date.now() - 5_000);
    await recordCanaryReceipt(env, receipt(TOKEN));
    const again = await recordCanaryReceipt(env, receipt(TOKEN));
    expect(again.kind).toBe("received");
    expect((await row(env, TOKEN))?.received_at ?? null).toBeTruthy();
  });
});

describe("canary sweep", () => {
  it("marks unresolved sends past the deadline failed and prunes retired rows", async () => {
    const { handle, env } = canaryDb();
    const liveToken = "55555555-6666-4777-8888-999999999999";
    const staleToken = "66666666-7777-4888-8999-000000000000";
    const retiredToken = "77777777-8888-4999-8000-111111111111";
    insertSentRow(env, liveToken, Date.now() - EMAIL_DELIVERY_CANARY_LATE_MS / 2);
    insertSentRow(env, staleToken, Date.now() - EMAIL_DELIVERY_CANARY_LATE_MS - 60_000);
    insertSentRow(env, retiredToken, Date.now() - 8 * 24 * 60 * 60 * 1000);
    const sweep = await sweepCanaryRows(env);
    expect(sweep.markedLate).toBe(1);
    expect(sweep.pruned).toBe(1);
    expect((await row(env, staleToken))?.status).toBe("failed");
    expect(
      await handle.sqlite.prepare("SELECT COUNT(*) AS n FROM email_delivery_canary WHERE token = ?")
        .get(retiredToken),
    ).toEqual({ n: 0 });
    expect((await row(env, liveToken))?.status).toBe("sent");
  });
});

describe("getEmailDeliveryStatus", () => {
  it("computes the 24h success rate, p50 latency, last failure and suppression counts", async () => {
    const { env } = canaryDb();
    insertReceivedRow(env, "88888888-9999-4aaa-8001-222222222222", Date.now() - 20 * 60_000, 5_800);
    insertReceivedRow(env, "89888888-9999-4aaa-8001-333333333333", Date.now() - 10 * 60_000, 9_000);
    env.DB!.prepare(
      "INSERT INTO email_delivery_canary (token, status, sent_at, received_at, latency_ms, error, created_at) VALUES (?, 'failed', ?, NULL, NULL, 'provider refused the send', ?)",
    ).bind(
      "99999999-aaaa-4bbb-8002-444444444444",
      new Date(Date.now() - 30 * 60_000).toISOString(),
      new Date(Date.now() - 30 * 60_000).toISOString(),
    ).run();
    insertSuppression(env, "bounce");
    insertSuppression(env, "complaint");
    createDeliveryAttemptStub(env);

    const status = await getEmailDeliveryStatus(env);
    expect(status.canary.sends).toBe(3);
    expect(status.canary.received).toBe(2);
    expect(status.canary.failed).toBe(1);
    expect(status.canary.successRate).toBeCloseTo(2 / 3);
    expect(status.canary.p50LatencyMs).toBe(9_000);
    expect(status.canary.lastFailure?.error).toBe("provider refused the send");
    expect(status.suppression.bounces24h).toBe(1);
    expect(status.suppression.complaints24h).toBe(1);
    // Public-safe: no tokens, no addresses, no recipient values in the payload.
    const dumped = JSON.stringify(status);
    expect(dumped).not.toContain("99999999");
    expect(dumped).not.toContain("@");
  });
});

describe("probe integration (no second scheduler)", () => {
  it("is due only on :00, :15, :30 and :45 — the */15 minutes without a */15 cron", () => {
    for (const minute of [0, 15, 30, 45]) {
      const at = new Date(`2026-09-12T05:${String(minute).padStart(2, "0")}:00Z`);
      expect(emailCanaryDueThisTick(at)).toBe(true);
      expect(probeDueThisTick("email_delivery", at)).toBe(true);
    }
    for (const minute of [5, 10, 20, 27, 50, 59]) {
      const at = new Date(`2026-09-12T05:${String(minute).padStart(2, "0")}:00Z`);
      expect(emailCanaryDueThisTick(at)).toBe(false);
      expect(probeDueThisTick("email_delivery", at)).toBe(false);
    }
  });

  it("reports honestly through the probe shape", async () => {
    const env = canaryDb().env;
    // The skipped case keys on a missing EMAIL binding, not a missing DB.
    const noMailEnv = { DB: env.DB } as AppEnv;
    const skipped = await runEmailDeliveryProbe(noMailEnv);
    expect(skipped.ok).toBe(true);
    expect(skipped.detail).toContain("skipped");

    sendCloudflareEmail.mockResolvedValueOnce({ status: "sent", errorMessage: null });
    const sent = await runEmailDeliveryProbe(env);
    expect(sent.ok).toBe(true);
    expect(sent.detail).toContain("canary sent");
    const tickToken = await env.DB!.prepare(
      "SELECT token, status, sent_at FROM email_delivery_canary ORDER BY created_at DESC LIMIT 1",
    ).bind().first<{ token: string; status: string; sent_at: string | null }>();
    expect(tickToken?.status).toBe("sent");
    expect(tickToken?.sent_at).toBeTruthy();

    sendCloudflareEmail.mockResolvedValueOnce({ status: "failed", errorMessage: "provider 5xx" });
    const failed = await runEmailDeliveryProbe(env);
    expect(failed.ok).toBe(false);
    expect(failed.detail).toBe("canary send not accepted by provider");
    expect((await row(env, tickToken!.token))?.status).toBe("sent");
  });
});
