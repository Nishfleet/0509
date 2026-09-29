import { describe, expect, it } from "vitest";

import { redactEmailShaped } from "../../app/lib/auth/redact-email-shaped";

describe("redactEmailShaped", () => {
  it("strips a dotted address, a local-part-only host, a URL with a token, and a bearer", () => {
    const text = redactEmailShaped(
      "quota exceeded for victim@example.com user@localhost HTTPS://0509.io/api/auth/magic-link/verify?token=abc123 Bearer secret-token",
    );
    expect(text).toContain("quota exceeded for");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("victim@example.com");
    expect(text).not.toContain("user@localhost");
    expect(text).not.toContain("https://");
    expect(text).not.toContain("HTTPS://");
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("secret-token");
  });

  it("leaves a message with no address or URL alone", () => {
    expect(redactEmailShaped("account daily sending quota exceeded")).toBe(
      "account daily sending quota exceeded",
    );
  });
});
