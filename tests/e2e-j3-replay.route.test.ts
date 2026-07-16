import { describe, expect, it } from "vitest";

import {
  isWorkflowAcceptanceStatus,
  loader,
  resolveJ3ReplayAction,
} from "~/routes/api.e2e.j3.replay";

describe("Journey 3 localhost replay route contract", () => {
  it.each([
    ["e2e-j3-workflow-accept", "e2e-starter", "e2e-run-j3-workflow-accept", "workflow_accept"],
    ["e2e-j3-crash-reclaim", "e2e-starter", "e2e-run-j3-crash-reclaim", "crash_reclaim"],
    ["e2e-j3-reconcile", "e2e-starter", "e2e-run-j3-reconcile", "reconcile"],
    ["e2e-j3-delivery-denied", "e2e-starter", "e2e-run-j3-delivery-denied", "delivery_denied"],
    ["e2e-j3-unsubscribe-cas", "e2e-free", "e2e-run-j3-unsubscribe-cas", "unsubscribe_cas"],
    ["e2e-j3-recover", "e2e-starter", "e2e-run-j3-recover", "recover"],
  ] as const)("maps only the allowlisted %s action", (idempotencyKey, userId, runId, action) => {
    expect(resolveJ3ReplayAction(idempotencyKey, userId, runId)).toBe(action);
  });

  it("rejects unknown keys and valid keys bound to another persona", () => {
    expect(resolveJ3ReplayAction("e2e-j3-unknown", "e2e-starter", "e2e-run-j3-unknown")).toBeNull();
    expect(resolveJ3ReplayAction("e2e-j3-unsubscribe-cas", "e2e-starter", "e2e-run-j3-unsubscribe-cas")).toBeNull();
    expect(resolveJ3ReplayAction("e2e-j3-workflow-accept", "e2e-free", "e2e-run-j3-workflow-accept")).toBeNull();
    expect(resolveJ3ReplayAction("e2e-j3-workflow-accept", "e2e-starter", "e2e-run-j3-other")).toBeNull();
  });

  it.each(["375x812", "768x900", "1440x900"])(
    "binds viewport-scoped monitoring and digest replay keys at %s",
    (viewport) => {
      expect(resolveJ3ReplayAction(
        `e2e-j3-workflow-accept-monitoring-${viewport}`,
        "e2e-starter",
        `e2e-run-j3-workflow-accept-monitoring-${viewport}`,
      )).toBe("workflow_accept");
      expect(resolveJ3ReplayAction(
        `e2e-j3-recover-monitoring-${viewport}`,
        "e2e-starter",
        `e2e-run-j3-recover-monitoring-${viewport}`,
      )).toBe("recover");
      expect(resolveJ3ReplayAction(
        `e2e-j3-delivery-denied-digest-${viewport}`,
        "e2e-starter",
        `e2e-run-j3-delivery-denied-digest-${viewport}`,
      )).toBe("delivery_denied");
      expect(resolveJ3ReplayAction(
        `e2e-j3-unsubscribe-cas-digest-${viewport}`,
        "e2e-free",
        `e2e-run-j3-unsubscribe-cas-digest-${viewport}`,
      )).toBe("unsubscribe_cas");
      expect(resolveJ3ReplayAction(
        `e2e-j3-recover-digest-${viewport}`,
        "e2e-starter",
        `e2e-run-j3-recover-digest-${viewport}`,
      )).toBe("recover");
    },
  );

  it("does not expose replay state through GET", () => {
    const response = loader({} as never);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["queued", "running", "paused", "complete", "waiting", "waitingForPause"])(
    "accepts the durable Workflow %s status",
    (status) => {
      expect(isWorkflowAcceptanceStatus(status)).toBe(true);
    },
  );

  it.each(["unknown", "errored", "terminated", ""])(
    "rejects the non-accepted Workflow %s status",
    (status) => {
      expect(isWorkflowAcceptanceStatus(status)).toBe(false);
    },
  );
});
