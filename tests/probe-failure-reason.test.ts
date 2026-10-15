import { describe, expect, it } from "vitest";

import { probeFailureReason, ReadUrlError } from "../app/lib/fetch/transport.server";

describe("probeFailureReason", () => {
  it.each(["unreachable", "escalation-failed"] as const)("keeps the reason a ReadUrlError carries for %s", (reason) => {
    expect(probeFailureReason(new ReadUrlError(reason))).toBe(reason);
  });

  it("falls back to probe-failed for a plain Error without leaking its message", () => {
    const reason = probeFailureReason(new Error("boom"));
    expect(reason).toBe("probe-failed");
    expect(reason).not.toContain("boom");
  });

  it.each([undefined, null, "connection reset"])(
    "falls back to probe-failed for a non-ReadUrlError value (%j)",
    (value) => {
      expect(probeFailureReason(value)).toBe("probe-failed");
    },
  );
});
