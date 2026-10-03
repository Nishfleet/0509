import { describe, expect, it } from "vitest";

import { passkeyLabel } from "../app/lib/passkey-label";

describe("the label on a passkey row", () => {
  it("uses the name when there is one", () => {
    expect(passkeyLabel("Work laptop", new Date("2026-10-02T12:00:00Z"))).toBe("Work laptop, added 2 Oct 2026");
  });

  it("writes the month the same way the rest of the app does", () => {
    expect(passkeyLabel("Work laptop", "2026-09-02T10:00:00Z")).toBe("Work laptop, added 2 Sept 2026");
  });

  it.each([undefined, null, "", "   "])("falls back to Passkey for %j", (name) => {
    expect(passkeyLabel(name, "2026-03-09T23:59:00Z")).toBe("Passkey, added 9 Mar 2026");
  });

  it("drops the date when it cannot be read", () => {
    expect(passkeyLabel(null, "not a date")).toBe("Passkey");
  });
});
