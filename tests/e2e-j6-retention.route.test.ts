import { describe, expect, it } from "vitest";

import {
  createRetentionDbProxy,
  resolveJ6RetentionReplayAction,
  resolveJ6RetentionReplayMapping,
  resolveJ6RetentionStateRequest,
} from "~/lib/e2e-j6-retention-replay.server";

const viewports = ["375x812", "768x900", "1440x900"] as const;

function stateRequest(key: string, runId: string, options: { url?: string; method?: string; cookie?: string; marker?: string } = {}) {
  return new Request(
    options.url ?? `http://127.0.0.1:43127/api/e2e/retention/state?idempotencyKey=${key}&runId=${runId}`,
    {
      method: options.method ?? "GET",
      headers: {
        cookie: options.cookie ?? "f9_e2e_fixture=e2e-starter",
        "x-0509-e2e-test-mode": options.marker ?? "1",
      },
    },
  );
}

describe("Journey 6 retention replay route contract", () => {
  it.each(viewports)("maps only the fixed failure/recovery identities at %s", (viewport) => {
    for (const outcome of ["failure", "recovery"] as const) {
      const key = `e2e-j6-retention-${outcome}-${viewport}`;
      const runId = `e2e-run-j6-retention-${outcome}-${viewport}`;
      expect(resolveJ6RetentionReplayAction(key, "e2e-starter", runId)).toBe(outcome);
      expect(resolveJ6RetentionReplayMapping(key, "e2e-starter", runId)).toMatchObject({
        outcome,
        userId: "e2e-starter",
        viewport,
      });
    }
  });

  it("fails closed for unknown identities and non-fixture state requests", () => {
    expect(resolveJ6RetentionReplayAction("e2e-j6-retention-other", "e2e-starter", "e2e-run-other")).toBeNull();
    expect(resolveJ6RetentionReplayAction(
      "e2e-j6-retention-failure-375x812",
      "e2e-agency",
      "e2e-run-j6-retention-failure-375x812",
    )).toBeNull();
    const key = "e2e-j6-retention-failure-375x812"; // gitleaks:allow -- deterministic fixture identifier.
    const runId = "e2e-run-j6-retention-failure-375x812";
    expect(resolveJ6RetentionStateRequest(stateRequest(key, runId))).toMatchObject({ idempotencyKey: key, runId });
    expect(resolveJ6RetentionStateRequest(stateRequest(key, runId, { method: "POST" }))).toBeNull();
    expect(resolveJ6RetentionStateRequest(stateRequest(key, runId, { marker: "0" }))).toBeNull();
    expect(resolveJ6RetentionStateRequest(stateRequest(key, runId, { cookie: "f9_e2e_fixture=e2e-agency" }))).toBeNull();
    expect(resolveJ6RetentionStateRequest(stateRequest(key, runId, {
      url: `https://0509.io/api/e2e/retention/state?idempotencyKey=${key}&runId=${runId}`,
    }))).toBeNull();
    expect(resolveJ6RetentionStateRequest(stateRequest(key, runId, {
      url: `http://127.0.0.1:43127/api/e2e/retention/state?idempotencyKey=${key}&runId=${runId}&extra=1`,
    }))).toBeNull();
  });

  it("injects one discovery-cache failure while allowing the next attempt through", async () => {
    const calls: string[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async run() {
                calls.push(sql);
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const proxy = createRetentionDbProxy(db, true);
    await expect(proxy.prepare("DELETE FROM discovery_cache_entry WHERE cache_key = ?").bind("fixture").run()).rejects.toThrow();
    await proxy.prepare("DELETE FROM discovery_cache_entry WHERE cache_key = ?").bind("fixture").run();
    await proxy.prepare("DELETE FROM delivery_attempt WHERE id = ?").bind("fixture").run();
    expect(proxy.injectedFailure).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("discovery_cache_entry");
    expect(calls[1]).toContain("delivery_attempt");
  });
});
