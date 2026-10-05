import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ prepare: vi.fn(), batch: vi.fn() }));

vi.mock("cloudflare:workers", () => ({ env: { DB: db } }));
vi.mock("../../../app/lib/data/plan.server", () => ({
  readEntitlements: () => Promise.resolve({ competitors: 5 }),
}));

import { insertSelfEntity, replaceCompetitorYoutube, setCompetitorState } from "../../../app/lib/data/entity.server";
import { shouldRetryD1 } from "../../../app/lib/data/retries.server";

const NETWORK_LOST = "D1_ERROR: 50018: Network connection lost";
const NOW = "2026-10-05T12:00:00.000Z";

let randomStub: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Full jitter: pin the draw to 0 so retries wait 0ms and the give-up count
  // stays fast; production keeps the real draw.
  randomStub = vi.spyOn(Math, "random").mockReturnValue(0);
  db.prepare.mockReset();
  db.batch.mockReset();
});

afterEach(() => {
  randomStub.mockRestore();
});

function statementReturning(run: ReturnType<typeof vi.fn>) {
  return { bind: () => ({ run }) };
}

describe("idempotent D1 writes retry transient errors (0509#6986)", () => {
  it("setCompetitorState retries a lost connection once and lands the write", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error(NETWORK_LOST))
      .mockResolvedValueOnce({ meta: { changes: 1 } });
    db.prepare.mockReturnValue(statementReturning(run));

    await expect(setCompetitorState({ workspaceId: "ws-1", entityId: "e-1", state: "off", now: NOW })).resolves.toBe(
      true,
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("setCompetitorState does not retry a non-retryable D1 error", async () => {
    const run = vi.fn().mockRejectedValue(new Error("D1_ERROR: no such table: entity (1)"));
    db.prepare.mockReturnValue(statementReturning(run));

    await expect(setCompetitorState({ workspaceId: "ws-1", entityId: "e-1", state: "off", now: NOW })).rejects.toThrow(
      "no such table",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("setCompetitorState gives up after the documented 5 attempts", async () => {
    const run = vi.fn().mockRejectedValue(new Error(NETWORK_LOST));
    db.prepare.mockReturnValue(statementReturning(run));

    await expect(setCompetitorState({ workspaceId: "ws-1", entityId: "e-1", state: "off", now: NOW })).rejects.toThrow(
      "Network connection lost",
    );
    expect(run).toHaveBeenCalledTimes(5);
  });

  it("insertSelfEntity retries and reports the ON CONFLICT DO NOTHING no-op", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error(NETWORK_LOST))
      .mockResolvedValueOnce({ meta: { changes: 0 } });
    db.prepare.mockReturnValue(statementReturning(run));

    await expect(
      insertSelfEntity({
        id: "self-1",
        workspaceId: "ws-1",
        domain: "self.example",
        name: "Self",
        identityJson: "{}",
        now: NOW,
      }),
    ).resolves.toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("replaceCompetitorYoutube retries the whole guarded batch", async () => {
    const batch = vi
      .fn()
      .mockRejectedValueOnce(new Error(NETWORK_LOST))
      .mockResolvedValueOnce([{ meta: { changes: 1 } }, { meta: { changes: 1 } }]);
    db.batch.mockImplementation(batch);
    db.prepare.mockReturnValue({ bind: () => ({}) });

    await expect(
      replaceCompetitorYoutube({ workspaceId: "ws-1", entityId: "e-1", url: "https://www.youtube.com/@rival" }),
    ).resolves.toBe(true);
    expect(batch).toHaveBeenCalledTimes(2);
  });
});

describe("shouldRetryD1 follows the documented retryable-error list", () => {
  it("retries only the transient D1 errors the docs mark retryable, at most 5 attempts", () => {
    expect(shouldRetryD1(new Error(NETWORK_LOST), 2)).toBe(true);
    expect(shouldRetryD1(new Error("D1_ERROR: storage caused object to be reset"), 2)).toBe(true);
    expect(shouldRetryD1(new Error("D1_ERROR: reset because its code was updated"), 2)).toBe(true);
    expect(shouldRetryD1(new Error("D1_ERROR: no such table: entity (1)"), 2)).toBe(false);
    expect(shouldRetryD1(new Error(NETWORK_LOST), 6)).toBe(false);
  });
});
