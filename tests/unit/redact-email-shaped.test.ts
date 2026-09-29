import { describe, expect, it } from "vitest";

import { redactEmailShaped } from "../../app/lib/auth/redact-email-shaped";

describe("redactEmailShaped", () => {
  it("strips a dotted address, a local-part-only host, and a URL with a token", () => {
    const text = redactEmailShaped(
      "quota exceeded for victim@example.com user@localhost https://0509.io/api/auth/magic-link/verify?token=abc123",
    );
    expect(text).toContain("quota exceeded for");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("victim@example.com");
    expect(text).not.toContain("user@localhost");
    expect(text).not.toContain("https://");
    expect(text).not.toContain("abc123");
  });

  it("leaves a message with no address or URL alone", () => {
    expect(redactEmailShaped("account daily sending quota exceeded")).toBe(
      "account daily sending quota exceeded",
    );
  });
});
