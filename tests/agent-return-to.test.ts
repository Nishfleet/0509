import { describe, expect, it } from "vitest";

import { safeReturnTo } from "../app/lib/agent/paths";

describe("login's return address", () => {
  it("returns to the agent consent screen with its query intact", () => {
    expect(safeReturnTo("/oauth/authorize?client_id=x&state=y")).toBe("/oauth/authorize?client_id=x&state=y");
  });

  it.each([
    null,
    "",
    "https://evil.example/oauth/authorize",
    "//evil.example/oauth/authorize",
    "/\\evil.example/oauth/authorize",
    "/app/settings",
    "/oauth/authorize/../../app",
    "javascript:alert(1)",
  ])("sends anything else to /app: %s", (value) => {
    expect(safeReturnTo(value)).toBe("/app");
  });
});
