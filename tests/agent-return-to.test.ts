import { describe, expect, it } from "vitest";

import { safeReturnTo } from "../app/lib/agent/paths";

describe("login's return address", () => {
  it("returns to the agent consent screen with its query intact", () => {
    expect(safeReturnTo("/oauth/authorize?client_id=x&state=y")).toBe("/oauth/authorize?client_id=x&state=y");
  });

  it("returns to the onboarding identity card with its subject intact", () => {
    expect(safeReturnTo("/onboarding/identity?subject=gymshark.com")).toBe(
      "/onboarding/identity?subject=gymshark.com",
    );
  });

  it.each([
    null,
    "",
    "https://evil.example/oauth/authorize",
    "//evil.example/oauth/authorize",
    "/\\evil.example/oauth/authorize",
    "/app",
    "/app/settings",
    "/onboarding",
    "/onboarding/identity/",
    "https://evil.example/onboarding/identity?subject=x",
    "/oauth/authorize/../../app",
    "javascript:alert(1)",
  ])("sends anything else to /app: %s", (value) => {
    expect(safeReturnTo(value)).toBe("/app");
  });
});
