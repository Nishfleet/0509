import { describe, expect, it } from "vitest";

import {
  resolveJ4ReplayAction,
  resolveJ4ReplayStateRequest,
} from "~/routes/api.e2e.j4.replay";

const viewports = ["375x812", "768x900", "1440x900"] as const;

function stateRequest(
  key: string,
  runId: string,
  options: { url?: string; method?: string; cookie?: string; marker?: string } = {},
) {
  const url = options.url ?? `http://127.0.0.1:43127/api/e2e/j4/replay?idempotencyKey=${key}&runId=${runId}`;
  return new Request(url, {
    method: options.method ?? "GET",
    headers: {
      cookie: options.cookie ?? "f9_e2e_fixture=e2e-agency",
      "x-0509-e2e-test-mode": options.marker ?? "1",
    },
  });
}

describe("Journey 4 localhost replay route contract", () => {
  it.each(viewports)("binds fixed report, room, and failure actions at %s", (viewport) => {
    expect(resolveJ4ReplayAction(
      `e2e-j4-report-share-${viewport}`,
      "e2e-agency",
      `e2e-run-j4-report-share-${viewport}`,
    )).toBe("report_share");
    expect(resolveJ4ReplayAction(
      `e2e-j4-client-room-${viewport}`,
      "e2e-agency",
      `e2e-run-j4-client-room-${viewport}`,
    )).toBe("client_room");
    expect(resolveJ4ReplayAction(
      `e2e-j4-batch-failure-${viewport}`,
      "e2e-agency",
      `e2e-run-j4-batch-failure-${viewport}`,
    )).toBe("batch_failure");
    expect(resolveJ4ReplayAction(
      `e2e-j4-approval-stale-${viewport}`,
      "e2e-agency",
      `e2e-run-j4-approval-stale-${viewport}`,
    )).toBe("approval_stale");
  });

  it("rejects unknown keys and persona/run mismatches", () => {
    expect(resolveJ4ReplayAction("e2e-j4-unknown", "e2e-agency", "e2e-run-j4-unknown")).toBeNull();
    expect(resolveJ4ReplayAction(
      "e2e-j4-report-share-375x812",
      "e2e-starter",
      "e2e-run-j4-report-share-375x812",
    )).toBeNull();
    expect(resolveJ4ReplayAction(
      "e2e-j4-report-share-375x812",
      "e2e-agency",
      "e2e-run-j4-report-share-other",
    )).toBeNull();
  });

  it("accepts only the exact loopback GET state identity", () => {
    const key = "e2e-j4-report-share-375x812";
    const runId = "e2e-run-j4-report-share-375x812";
    expect(resolveJ4ReplayStateRequest(stateRequest(key, runId))).toMatchObject({
      action: "report_share",
      userId: "e2e-agency",
      idempotencyKey: key,
      runId,
      viewport: "375x812",
    });
    expect(resolveJ4ReplayStateRequest(stateRequest(key, runId, { method: "POST" }))).toBeNull();
    expect(resolveJ4ReplayStateRequest(stateRequest(key, runId, { marker: "0" }))).toBeNull();
    expect(resolveJ4ReplayStateRequest(stateRequest(key, runId, { cookie: "f9_e2e_fixture=e2e-starter" }))).toBeNull();
    expect(resolveJ4ReplayStateRequest(stateRequest(key, runId, {
      url: `https://0509.io/api/e2e/j4/replay?idempotencyKey=${key}&runId=${runId}`,
    }))).toBeNull();
    expect(resolveJ4ReplayStateRequest(stateRequest(key, runId, {
      url: `http://localhost:43127/api/e2e/j4/replay?idempotencyKey=${key}&runId=${runId}`,
    }))).toBeNull();
    expect(resolveJ4ReplayStateRequest(stateRequest(key, runId, {
      url: `http://127.0.0.1:43127/api/e2e/j4/replay?idempotencyKey=${key}&runId=${runId}&extra=1`,
    }))).toBeNull();
  });

  it("rejects duplicated fixture cookies and mismatched state keys", () => {
    const key = "e2e-j4-client-room-768x900";
    const runId = "e2e-run-j4-client-room-768x900";
    expect(resolveJ4ReplayStateRequest(stateRequest(key, runId, {
      cookie: "f9_e2e_fixture=e2e-agency; f9_e2e_fixture=e2e-agency",
    }))).toBeNull();
    expect(resolveJ4ReplayStateRequest(stateRequest(key, "e2e-run-j4-client-room-375x812"))).toBeNull();
  });
});
