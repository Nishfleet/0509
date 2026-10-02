import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));

const slots = vi.hoisted(() => ({
  claimChangeSlot: vi.fn(),
  claimSendAttempt: vi.fn(),
  resolveSendAttempt: vi.fn(),
  writeUnsubscribeToken: vi.fn(),
  readSlackTarget: vi.fn(),
  postToSlack: vi.fn(),
}));

vi.mock("../../app/lib/data/send_attempt.server", () => ({
  claimChangeSlot: slots.claimChangeSlot,
  claimSendAttempt: slots.claimSendAttempt,
  resolveSendAttempt: slots.resolveSendAttempt,
}));
vi.mock("../../app/lib/data/send_target.server", () => ({
  writeUnsubscribeToken: slots.writeUnsubscribeToken,
  readSlackTarget: slots.readSlackTarget,
}));
vi.mock("../../app/lib/slack.server", () => ({ postToSlack: slots.postToSlack }));

import { deliverChange, handleBatch, parseMessage } from "../../workers/delivery/consumer";

interface World {
  change: Record<string, unknown> | null;
  target: Record<string, unknown> | null;
  targetState: { is_verified: number; is_enabled: number } | null;
  suppressed: boolean;
  tokenAfterWrite: string | null;
  diff: string | null;
  sendFails: boolean;
}

const PAYLOAD = JSON.stringify({
  page: { role: "pricing", url: "https://rival.example/pricing" },
  before: { snapshotId: "a", screenshotKey: null },
  after: { snapshotId: "b", screenshotKey: null },
  diffKey: "diff-key",
  wordsAdded: 2,
  wordsRemoved: 2,
});

const CHANGE = {
  id: "sig-1",
  workspace_id: "ws-1",
  payload_json: PAYLOAD,
  observed_at: "2026-10-02T03:00:00.000Z",
  name: "Rival",
  domain: "rival.example",
  change_alerts: 1,
  timezone: "UTC",
};

const TARGET = {
  id: "tgt-1",
  workspace_id: "ws-1",
  channel_id: "ch-1",
  target_value: "owner@example.com",
  unsubscribe_token: "tok-1",
};

let world: World;
let sent: EmailMessageBuilder[];

function rowFor(sql: string): unknown {
  if (sql.includes("FROM signal s")) return world.change;
  if (sql.includes("c.is_enabled = 1")) return world.target;
  if (sql.includes("SELECT st.is_verified")) return world.targetState;
  if (sql.includes("email_suppression")) return world.suppressed ? { address: "owner@example.com" } : null;
  if (sql.includes("SELECT unsubscribe_token")) return { unsubscribe_token: world.tokenAfterWrite };
  return null;
}

function fakeEnv(): Env {
  return {
    DB: {
      prepare: (sql: string) => ({ bind: () => ({ first: () => Promise.resolve(rowFor(sql)) }) }),
    },
    SNAPSHOTS: {
      get: () => Promise.resolve(world.diff === null ? null : { text: () => Promise.resolve(world.diff) }),
    },
    EMAIL: {
      send(message: EmailMessageBuilder) {
        if (world.sendFails) return Promise.reject(new Error("smtp down"));
        sent.push(message);
        return Promise.resolve({ messageId: "m" });
      },
    },
  } as unknown as Env;
}

beforeEach(() => {
  vi.clearAllMocks();
  sent = [];
  world = {
    change: { ...CHANGE },
    target: { ...TARGET },
    targetState: null,
    suppressed: false,
    tokenAfterWrite: "tok-new",
    diff: JSON.stringify({ hunks: [{ lines: ["-Pro $12 a month", "+Pro $15 a month"] }] }),
    sendFails: false,
  };
  slots.claimChangeSlot.mockResolvedValue({ kind: "claimed", id: "att-1" });
  slots.claimSendAttempt.mockResolvedValue({ id: "att-over" });
  slots.readSlackTarget.mockResolvedValue(null);
  slots.postToSlack.mockResolvedValue(true);
});

describe("parseMessage", () => {
  it("reads each queue body shape", () => {
    expect(parseMessage(JSON.stringify({ digest_id: "d" }))).toEqual({ digest_id: "d" });
    expect(parseMessage({ incident_id: "i" })).toEqual({ incident_id: "i" });
    expect(parseMessage({ signal_id: "s" })).toEqual({ signal_id: "s" });
  });

  it("returns null for anything else", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(parseMessage("not json")).toBeNull();
    expect(parseMessage("null")).toBeNull();
    expect(parseMessage({ other: 1 })).toBeNull();
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage(7)).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
  });
});

describe("deliverChange", () => {
  it("sends one email with the before and after and the unsubscribe headers", async () => {
    const result = await deliverChange(fakeEnv(), { signal_id: "sig-1" });

    expect(result).toMatchObject({ outcome: "sent", attempt_id: "att-1", idempotency_key: "change:sig-1:tgt-1" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("owner@example.com");
    expect(sent[0]?.headers).toMatchObject({ "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(sent[0]?.text).toContain("Pro $15 a month");
  });

  it("sends without a before and after when the stored diff is missing", async () => {
    world.diff = null;
    expect((await deliverChange(fakeEnv(), { signal_id: "sig-1" })).outcome).toBe("sent");
    expect(sent[0]?.text).not.toContain("Pro $15");
  });

  it("makes an unsubscribe token when the address has none yet", async () => {
    world.target = { ...TARGET, unsubscribe_token: null };
    await deliverChange(fakeEnv(), { signal_id: "sig-1" });
    expect(slots.writeUnsubscribeToken).toHaveBeenCalledTimes(1);
    expect(sent[0]?.text).toContain("tok-new");
  });

  it("fails the attempt when the token cannot be read back", async () => {
    world.target = { ...TARGET, unsubscribe_token: null };
    world.tokenAfterWrite = null;
    const result = await deliverChange(fakeEnv(), { signal_id: "sig-1" });
    expect(result.outcome).toBe("failed");
    expect(sent).toHaveLength(0);
  });

  it("reports no_signal for an unknown signal and for a payload it cannot read", async () => {
    world.change = null;
    expect((await deliverChange(fakeEnv(), { signal_id: "x" })).outcome).toBe("no_signal");
    world.change = { ...CHANGE, payload_json: "{}" };
    expect((await deliverChange(fakeEnv(), { signal_id: "x" })).outcome).toBe("no_signal");
  });

  it("stays quiet when the workspace turned change alerts off", async () => {
    world.change = { ...CHANGE, change_alerts: 0 };
    expect((await deliverChange(fakeEnv(), { signal_id: "sig-1" })).outcome).toBe("muted");
    expect(sent).toHaveLength(0);
  });

  it("names why there is no target", async () => {
    world.target = null;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const cases: [World["targetState"], string][] = [
      [null, "no_row"],
      [{ is_verified: 1, is_enabled: 0 }, "channel_disabled"],
      [{ is_verified: 0, is_enabled: 1 }, "unverified"],
    ];
    for (const [state, reason] of cases) {
      world.targetState = state;
      const result = await deliverChange(fakeEnv(), { signal_id: "sig-1" });
      expect(result.outcome).toBe("no_target");
      expect(String(log.mock.calls.at(-1)?.[0])).toContain(reason);
    }
  });

  it("does not send to a suppressed address", async () => {
    world.suppressed = true;
    expect((await deliverChange(fakeEnv(), { signal_id: "sig-1" })).outcome).toBe("suppressed");
    expect(sent).toHaveLength(0);
  });

  it("does not send twice for the same change", async () => {
    slots.claimChangeSlot.mockResolvedValue({ kind: "duplicate" });
    const result = await deliverChange(fakeEnv(), { signal_id: "sig-1" });
    expect(result).toMatchObject({ outcome: "duplicate", attempt_id: null });
    expect(sent).toHaveLength(0);
  });

  it("sends one notice past the daily cap, then nothing", async () => {
    slots.claimChangeSlot.mockResolvedValue({ kind: "capped" });
    const first = await deliverChange(fakeEnv(), { signal_id: "sig-1" });
    expect(first.outcome).toBe("capped");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe("More rivals changed price or plan today");

    slots.claimSendAttempt.mockResolvedValue(null);
    const second = await deliverChange(fakeEnv(), { signal_id: "sig-2" });
    expect(second).toMatchObject({ outcome: "capped", attempt_id: null });
    expect(sent).toHaveLength(1);
  });

  it("records a failed send so it can be retried", async () => {
    world.sendFails = true;
    const result = await deliverChange(fakeEnv(), { signal_id: "sig-1" });
    expect(result.outcome).toBe("failed");
    expect(slots.resolveSendAttempt).toHaveBeenCalledWith(expect.anything(), {
      attemptId: "att-1",
      outcome: "failed",
      error: "smtp down",
    });
  });
});

describe("deliverChange to Slack", () => {
  const SLACK = { id: "tgt-slack", target_value: "https://hooks.slack.com/services/T1/B1/x" };

  it("posts the before and after to Slack as well as emailing", async () => {
    slots.readSlackTarget.mockResolvedValue(SLACK);
    const result = await deliverChange(fakeEnv(), { signal_id: "sig-1" });
    expect(result.outcome).toBe("sent");
    expect(sent).toHaveLength(1);
    const [url, text] = slots.postToSlack.mock.calls[0] ?? [];
    expect(url).toBe(SLACK.target_value);
    expect(text).toContain("Before: Pro $12 a month");
    expect(text).toContain("After: Pro $15 a month");
  });

  it("keeps the Slack post out of the email cap", async () => {
    slots.readSlackTarget.mockResolvedValue(SLACK);
    await deliverChange(fakeEnv(), { signal_id: "sig-1" });
    expect(slots.claimChangeSlot).toHaveBeenCalledTimes(1);
    expect(slots.claimChangeSlot.mock.calls[0]?.[1].idempotencyKey).toBe("change:sig-1:tgt-1");
    expect(slots.claimSendAttempt.mock.calls[0]?.[1].idempotencyKey).toBe("change-slack:sig-1:tgt-slack");
  });

  it("posts without a before and after when the stored diff is missing", async () => {
    slots.readSlackTarget.mockResolvedValue(SLACK);
    world.diff = null;
    await deliverChange(fakeEnv(), { signal_id: "sig-1" });
    expect(String(slots.postToSlack.mock.calls[0]?.[1])).not.toContain("Before:");
  });

  it("does not post twice for the same change", async () => {
    slots.readSlackTarget.mockResolvedValue(SLACK);
    slots.claimSendAttempt.mockResolvedValue(null);
    await deliverChange(fakeEnv(), { signal_id: "sig-1" });
    expect(slots.postToSlack).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });

  it("reports failed so the queue retries when Slack refuses the post", async () => {
    slots.readSlackTarget.mockResolvedValue(SLACK);
    slots.postToSlack.mockResolvedValue(false);
    expect((await deliverChange(fakeEnv(), { signal_id: "sig-1" })).outcome).toBe("failed");
    slots.postToSlack.mockRejectedValue(new Error("network"));
    expect((await deliverChange(fakeEnv(), { signal_id: "sig-1" })).outcome).toBe("failed");
  });

  it("still emails when there is no Slack channel", async () => {
    await deliverChange(fakeEnv(), { signal_id: "sig-1" });
    expect(slots.postToSlack).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });
});

describe("handleBatch", () => {
  function batchOf(...bodies: unknown[]) {
    const items = bodies.map((body) => ({ body, ack: vi.fn(), retry: vi.fn() }));
    return { items, batch: { messages: items } as unknown as MessageBatch };
  }

  it("acks what it cannot read, acks a send and retries a failure", async () => {
    const { items, batch } = batchOf({ nope: true }, { signal_id: "sig-1" });
    const results = await handleBatch(fakeEnv(), batch);
    expect(results.map((r) => r.outcome)).toEqual(["no_digest", "sent"]);
    expect(items[0]?.ack).toHaveBeenCalled();
    expect(items[1]?.ack).toHaveBeenCalled();

    world.sendFails = true;
    const failing = batchOf({ signal_id: "sig-1" });
    await handleBatch(fakeEnv(), failing.batch);
    expect(failing.items[0]?.retry).toHaveBeenCalled();
    expect(failing.items[0]?.ack).not.toHaveBeenCalled();
  });
});
