import { describe, expect, it } from "vitest";

import { DEAD_LINK_MESSAGE, deadLinkMessage } from "../app/lib/auth/link-error";

describe("deadLinkMessage", () => {
  it.each(["INVALID_TOKEN", "EXPIRED_TOKEN", "ATTEMPTS_EXCEEDED"])("explains %s", (code) => {
    expect(deadLinkMessage(new URLSearchParams({ error: code }))).toBe(DEAD_LINK_MESSAGE);
  });

  it("stays silent without an error or with one it does not know", () => {
    expect(deadLinkMessage(new URLSearchParams())).toBeNull();
    expect(deadLinkMessage(new URLSearchParams({ error: "<b>x</b>" }))).toBeNull();
  });
});
