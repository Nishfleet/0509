import { describe, expect, it } from "vitest";

import { createAuth } from "~/lib/auth.server";

describe("createAuth", () => {
  it("fails closed when the auth secret is missing", () => {
    expect(() =>
      createAuth(
        { DB: {} as D1Database },
        new Request("https://0509.io/app"),
      ),
    ).toThrow("BETTER_AUTH_SECRET");
  });

  it("fails closed when the auth secret is too short", () => {
    expect(() =>
      createAuth(
        {
          DB: {} as D1Database,
          BETTER_AUTH_SECRET: "short",
        },
        new Request("https://0509.io/app"),
      ),
    ).toThrow("BETTER_AUTH_SECRET");
  });
});
