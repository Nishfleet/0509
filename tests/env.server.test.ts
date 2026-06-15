import { describe, expect, it } from "vitest";

import { appOrigin, isWhatsAppWebhookConfigured } from "~/lib/env.server";

describe("appOrigin", () => {
  it("prefers BETTER_AUTH_URL when configured", () => {
    const request = new Request("https://0509.nishant345.workers.dev/auth/login");

    expect(
      appOrigin({ BETTER_AUTH_URL: "https://0509.io" }, request),
    ).toBe("https://0509.io");
  });

  it("uses the forwarded public host when present", () => {
    const request = new Request("https://0509.nishant345.workers.dev/auth/login", {
      headers: {
        "x-forwarded-host": "0509.io",
        "x-forwarded-proto": "https",
      },
    });

    expect(appOrigin({}, request)).toBe("https://0509.io");
  });

  it("parses the RFC forwarded header before falling back to request.url", () => {
    const request = new Request("https://0509.nishant345.workers.dev/auth/login", {
      headers: {
        forwarded: "for=192.0.2.60;proto=https;host=0509.io",
      },
    });

    expect(appOrigin({}, request)).toBe("https://0509.io");
  });

  it("falls back to the incoming request origin when no proxy headers are set", () => {
    const request = new Request("https://0509.nishant345.workers.dev/auth/login");

    expect(appOrigin({}, request)).toBe("https://0509.nishant345.workers.dev");
  });
});

describe("isWhatsAppWebhookConfigured", () => {
  it("requires both the app signing secret and verification token", () => {
    expect(isWhatsAppWebhookConfigured({})).toBe(false);
    expect(isWhatsAppWebhookConfigured({ WHATSAPP_APP_SECRET: "secret" })).toBe(false);
    expect(isWhatsAppWebhookConfigured({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify" })).toBe(false);
    expect(
      isWhatsAppWebhookConfigured({
        WHATSAPP_APP_SECRET: "secret",
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify",
      }),
    ).toBe(true);
  });
});
