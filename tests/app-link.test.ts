import { describe, expect, it } from "vitest";

import { appLinkTarget } from "~/lib/app-link";

describe("appLinkTarget", () => {
  it("keeps the app route for signed-in visitors", () => {
    const session = {
      user: { id: "u1", email: "a@b.c", name: "A" },
      session: { id: "s1", userId: "u1", expiresAt: "" },
    };
    expect(appLinkTarget("/app", session)).toBe("/app");
    expect(appLinkTarget("/app/notifications", session)).toBe("/app/notifications");
    expect(appLinkTarget("/app/support?category=billing", session)).toBe(
      "/app/support?category=billing",
    );
  });

  it("points anonymous visitors straight at the login page with the app route preserved", () => {
    expect(appLinkTarget("/app", null)).toBe("/auth/login?redirectTo=%2Fapp");
    expect(appLinkTarget("/app", undefined)).toBe("/auth/login?redirectTo=%2Fapp");
    expect(appLinkTarget("/app/developer-access", null)).toBe(
      "/auth/login?redirectTo=%2Fapp%2Fdeveloper-access",
    );
    // Query strings are preserved in the encoded redirect target so the
    // post-login landing is byte-identical to the app-route guard's redirect.
    expect(appLinkTarget("/app/support?category=billing", null)).toBe(
      "/auth/login?redirectTo=%2Fapp%2Fsupport%3Fcategory%3Dbilling",
    );
  });
});
