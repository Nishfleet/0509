import { describe, expect, it } from "vitest";

import {
  resolveJ6ReplayAction,
  resolveJ6ReplayClaim,
  resolveJ6ReplayCompletion,
  resolveJ6ReplayMapping,
  resolveJ6ReplayStateRequest,
} from "~/routes/api.e2e.j6.support";

const viewports = ["375x812", "768x900", "1440x900"] as const;

function stateRequest(
  idempotencyKey: string,
  runId: string,
  options: { url?: string; method?: string; cookie?: string; marker?: string } = {},
) {
  return new Request(
    options.url ?? `http://127.0.0.1:43127/api/e2e/support/state?idempotencyKey=${idempotencyKey}&runId=${runId}`,
    {
      method: options.method ?? "GET",
      headers: {
        cookie: options.cookie ?? "f9_e2e_fixture=e2e-support-recovery",
        "x-0509-e2e-test-mode": options.marker ?? "1",
      },
    },
  );
}

describe("Journey 6 localhost support replay route contract", () => {
  it.each(viewports)("maps failure and recovery to one case per viewport (%s)", (viewport) => {
    for (const outcome of ["failure", "recovery"] as const) {
      const key = `e2e-j6-support-${outcome}-${viewport}`;
      const runId = `e2e-run-j6-support-${outcome}-${viewport}`;
      expect(resolveJ6ReplayAction(key, "e2e-support-recovery", runId)).toBe(outcome);
      expect(resolveJ6ReplayMapping(key, "e2e-support-recovery", runId)).toMatchObject({
        outcome,
        userId: "e2e-support-recovery",
        caseId: "e2e-support-recovery-case",
        viewport,
      });
    }
  });

  it("rejects unknown keys and identity mismatches", () => {
    expect(resolveJ6ReplayAction("e2e-j6-support-unknown", "e2e-support-recovery", "e2e-run-j6-support-unknown")).toBeNull();
    expect(resolveJ6ReplayAction(
      "e2e-j6-support-failure-375x812",
      "e2e-starter",
      "e2e-run-j6-support-failure-375x812",
    )).toBeNull();
    expect(resolveJ6ReplayAction(
      "e2e-j6-support-failure-375x812",
      "e2e-support-recovery",
      "e2e-run-j6-support-failure-other",
    )).toBeNull();
  });

  it("accepts only exact loopback state requests bound to one fixture cookie", () => {
    const key = "e2e-j6-support-failure-375x812";
    const runId = "e2e-run-j6-support-failure-375x812";
    expect(resolveJ6ReplayStateRequest(stateRequest(key, runId))).toMatchObject({ idempotencyKey: key, runId });
    expect(resolveJ6ReplayStateRequest(stateRequest(key, runId, { method: "POST" }))).toBeNull();
    expect(resolveJ6ReplayStateRequest(stateRequest(key, runId, { marker: "0" }))).toBeNull();
    expect(resolveJ6ReplayStateRequest(stateRequest(key, runId, { cookie: "f9_e2e_fixture=e2e-starter" }))).toBeNull();
    expect(resolveJ6ReplayStateRequest(stateRequest(key, runId, {
      cookie: "f9_e2e_fixture=e2e-support-recovery; f9_e2e_fixture=e2e-support-recovery",
    }))).toBeNull();
    expect(resolveJ6ReplayStateRequest(stateRequest(key, runId, {
      url: "https://0509.io/api/e2e/support/state?idempotencyKey=e2e-j6-support-failure-375x812&runId=e2e-run-j6-support-failure-375x812",
    }))).toBeNull();
    expect(resolveJ6ReplayStateRequest(stateRequest(key, runId, {
      url: "http://localhost:43127/api/e2e/support/state?idempotencyKey=e2e-j6-support-failure-375x812&runId=e2e-run-j6-support-failure-375x812",
    }))).toBeNull();
    expect(resolveJ6ReplayStateRequest(stateRequest(key, runId, {
      url: `http://127.0.0.1:43127/api/e2e/support/state?idempotencyKey=${key}&runId=${runId}&extra=1`,
    }))).toBeNull();
  });

  it("gives only the processing-token owner a replay lease", () => {
    const row = {
      action: "failure" as const,
      status: "started" as const,
      processing_token: "owner-token",
      run_id: "e2e-run-j6-support-failure-375x812",
    };
    expect(resolveJ6ReplayClaim(row, "owner-token", row.run_id)).toBe("claimed");
    expect(resolveJ6ReplayClaim(row, "foreign-token", row.run_id)).toBe("in_progress");
    expect(resolveJ6ReplayClaim(row, "owner-token", "other-run")).toBe("invalid");
  });

  it("requires same token/run and exactly one changed row to complete", () => {
    const input = {
      changes: 1,
      currentStatus: "started",
      currentToken: "owner-token",
      currentRunId: "run-1",
      processingToken: "owner-token",
      runId: "run-1",
    };
    expect(resolveJ6ReplayCompletion(input)).toBe(true);
    expect(resolveJ6ReplayCompletion({ ...input, changes: 0 })).toBe(false);
    expect(resolveJ6ReplayCompletion({ ...input, currentToken: "foreign-token" })).toBe(false);
    expect(resolveJ6ReplayCompletion({ ...input, currentRunId: "run-2" })).toBe(false);
    expect(resolveJ6ReplayCompletion({ ...input, currentStatus: "succeeded" })).toBe(false);
  });
});
