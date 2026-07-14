import { describe, expect, it } from "vitest";

import { loader as loginLoader } from "~/routes/auth.login-alias";
import { loader as signupLoader } from "~/routes/auth.signup-alias";

describe("short auth routes", () => {
  it.each([
    [signupLoader, "https://0509.io/signup?email=owner%40example.com", "/auth/signup?email=owner%40example.com"],
    [loginLoader, "https://0509.io/login?redirectTo=%2Fapp", "/auth/login?redirectTo=%2Fapp"],
  ])("redirects short auth URLs without losing query context", async (loader, url, expected) => {
    try {
      await loader({ request: new Request(url) } as never);
      throw new Error("Expected auth alias redirect");
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(expected);
    }
  });
});
