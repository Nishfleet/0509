import { describe, expect, it } from "vitest";

import { pausedReasonLine, retireReasonLine } from "../../app/lib/competitor/reason-customer";

describe("retireReasonLine", () => {
  it("maps each retire code to its customer-facing line", () => {
    expect(retireReasonLine("active")).toBe("We're not sure it still competes with you");
    expect(retireReasonLine("acquired")).toBe("Looks like it was acquired");
    expect(retireReasonLine("shut_down")).toBe("Looks like it shut down");
    expect(retireReasonLine("pivoted")).toBe("Looks like it changed what it sells");
    expect(retireReasonLine("dormant")).toBe("Quiet for the last 30 days");
  });

  it("falls back to the active line for a code the map does not know", () => {
    expect(retireReasonLine("went_public")).toBe("We're not sure it still competes with you");
  });

  it("falls back to the active line for the inherited toString name", () => {
    expect(retireReasonLine("toString")).toBe("We're not sure it still competes with you");
  });
});

describe("pausedReasonLine", () => {
  it("gives no line when the competitor has no pause reason", () => {
    expect(pausedReasonLine(null)).toBeUndefined();
  });

  it("gives no line for a code that is not a pause reason", () => {
    expect(pausedReasonLine("dormant")).toBeUndefined();
    expect(pausedReasonLine("active")).toBeUndefined();
  });

  it("lowercases the first letter of the acquired line", () => {
    expect(pausedReasonLine("acquired")).toBe("looks like it was acquired");
  });

  it("lowercases the first letter of the shut_down line", () => {
    expect(pausedReasonLine("shut_down")).toBe("looks like it shut down");
  });
});
