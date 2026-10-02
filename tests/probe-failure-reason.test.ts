import { describe, expect, it } from "vitest";

import { probeFailureReason, ReadUrlError } from "../app/lib/fetch/transport.server";

/**
 * probeFailureReason maps a failed-probe error to the reason stored: a
 * ReadUrlError keeps its own reason, anything else becomes "probe-failed".
 * These cases pin that boundary so a raw error message never leaks into a
 * stored probe reason (0509#6575).
 */
describe("probeFailureReason", () => {
  // ReadUrlFailureReason is the union at transport.server.ts:39 — these two
  // members are real values of it, proving the error carries its own reason
  // rather than the catch-all.
  it.each(["unreachable", "escalation-failed"] as const)("keeps the reason a ReadUrlError carries for %s", (reason) => {
    expect(probeFailureReason(new ReadUrlError(reason))).toBe(reason);
  });

  // A plain Error is not a ReadUrlError, so the stored reason must be the
  // generic value and must not contain the error's message ("boom").
  it("falls back to probe-failed for a plain Error without leaking its message", () => {
    const reason = probeFailureReason(new Error("boom"));
    expect(reason).toBe("probe-failed");
    expect(reason).not.toContain("boom");
  });

  // Anything thrown (a string) or non-Error (null, undefined) is not a
  // ReadUrlError, so each falls back to the generic reason.
  it.each([undefined, null, "connection reset"])(
    "falls back to probe-failed for a non-ReadUrlError value (%j)",
    (value) => {
      expect(probeFailureReason(value)).toBe("probe-failed");
    },
  );
});
