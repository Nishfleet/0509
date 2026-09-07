import { describe, expect, it } from "vitest";

import { shouldAttemptFreeActivationResult } from "~/lib/monitoring.server";

describe("free activation result observability", () => {
  it("re-enters the idempotent delivery claim after the first successful scan", () => {
    expect(shouldAttemptFreeActivationResult(null, true, 3)).toBe(true);
    expect(shouldAttemptFreeActivationResult(null, false, 0)).toBe(true);
    expect(shouldAttemptFreeActivationResult(null, false, 3)).toBe(false);
    expect(shouldAttemptFreeActivationResult("baseline-run", false, 3)).toBe(true);
  });
});
