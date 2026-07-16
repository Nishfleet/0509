import { describe, expect, it } from "vitest";
import { requireExactReleaseBaseURL } from "../e2e/helpers/release-origin";

describe("release browser fixture origin", () => {
  it("returns only the exact isolated loopback origin", () => {
    expect(requireExactReleaseBaseURL("http://127.0.0.1:43127")).toBe("http://127.0.0.1:43127");
  });

  it("fails closed instead of falling back to a shared or remote origin", () => {
    expect(() => requireExactReleaseBaseURL(undefined)).toThrow("missing_release_base_url");
    for (const value of [
      "http://127.0.0.1:4179/fixture",
      "http://localhost:43127",
      "https://127.0.0.1:43127",
      "http://127.0.0.1:1",
      "https://0509.io",
    ]) {
      expect(() => requireExactReleaseBaseURL(value)).toThrow("invalid_release_base_url");
    }
  });
});
