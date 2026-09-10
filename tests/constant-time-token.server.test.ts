import { describe, expect, it } from "vitest";

import { constantTimeTokenEqual } from "~/lib/constant-time-token.server";

describe("constantTimeTokenEqual", () => {
  it("returns true for identical tokens", async () => {
    await expect(constantTimeTokenEqual("pulse-secret-token", "pulse-secret-token")).resolves.toBe(
      true,
    );
  });

  it("returns true for a token equal up to dataset boundaries (surrogate pair)", async () => {
    await expect(constantTimeTokenEqual("⭐-token", "⭐-token")).resolves.toBe(true);
  });

  it("returns false for differing tokens", async () => {
    await expect(constantTimeTokenEqual("pulse-secret-token", "pulse-secret-tockn")).resolves.toBe(
      false,
    );
    await expect(constantTimeTokenEqual("a", "b")).resolves.toBe(false);
  });

  it("returns false when either side is empty while the other is not", async () => {
    await expect(constantTimeTokenEqual("", "secret")).resolves.toBe(false);
    await expect(constantTimeTokenEqual("secret", "")).resolves.toBe(false);
  });

  it("returns false for non-string inputs", async () => {
    await expect(constantTimeTokenEqual(undefined, "secret")).resolves.toBe(false);
    await expect(constantTimeTokenEqual(null, "secret")).resolves.toBe(false);
    await expect(constantTimeTokenEqual("secret", undefined)).resolves.toBe(false);
  });

  it("treats an empty token as invalid (an unset secret must never validate)", async () => {
    await expect(constantTimeTokenEqual("", "secret")).resolves.toBe(false);
    await expect(constantTimeTokenEqual("secret", "")).resolves.toBe(false);
    await expect(constantTimeTokenEqual("", "")).resolves.toBe(false);
  });

  it("distinguishes a one-char prefix match from a full match (timing-oracle regression)", async () => {
    const full = "pulse-secret-token-ab";
    const prefix = full.substring(0, full.length - 1);
    await expect(constantTimeTokenEqual(prefix, full)).resolves.toBe(false);
  });
});
