import { describe, expect, it } from "vitest";

import { appOrigin } from "~/lib/env.server";

describe("appOrigin", () => {
  it("prefers BETTER_AUTH_URL when configured", () => {
    const request = new Request("https://0509.nishant345.workers.dev/auth/login");

    expect(
      appOrigin({ BETTER_AUTH_URL: "https://0509.in" }, request),
    ).toBe("https://0509.in");
  });

  it("uses the forwarded public host when present", () => {
    const request = new Request("https://0509.nishant345.workers.dev/auth/login", {
      headers: {
        "x-forwarded-host": "0509.in",
        "x-forwarded-proto": "https",
      },
    });

    expect(appOrigin({}, request)).toBe("https://0509.in");
  });

  it("parses the RFC forwarded header before falling back to request.url", () => {
    const request = new Request("https://0509.nishant345.workers.dev/auth/login", {
      headers: {
        forwarded: "for=192.0.2.60;proto=https;host=0509.in",
      },
    });

    expect(appOrigin({}, request)).toBe("https://0509.in");
  });

  it("falls back to the incoming request origin when no proxy headers are set", () => {
    const request = new Request("https://0509.nishant345.workers.dev/auth/login");

    expect(appOrigin({}, request)).toBe("https://0509.nishant345.workers.dev");
  });
});
