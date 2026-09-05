import { describe, expect, it } from "vitest";

import {
  appOrigin,
  isSignupFirstBriefEnabled,
  isWhatsAppWebhookConfigured,
} from "~/lib/env.server";

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

describe("isSignupFirstBriefEnabled", () => {
  // Regression guard for issue #1416: the BET 7 first-brief feature was built
  // and tested (#1276) but never enabled because SIGNUP_FIRST_BRIEF_ENABLED
  // was absent from wrangler.jsonc. parseEnvFlag must return true for "1" and
  // false when the flag is missing, so the flag cannot silently disappear
  // again — a missing flag means a new free signup waits up to 7 days for
  // their first value (BET 7).
  it("is off when the flag is absent and on only for parseEnvFlag truthy values", () => {
    expect(isSignupFirstBriefEnabled({})).toBe(false);
    expect(isSignupFirstBriefEnabled({ SIGNUP_FIRST_BRIEF_ENABLED: "0" })).toBe(false);
    expect(isSignupFirstBriefEnabled({ SIGNUP_FIRST_BRIEF_ENABLED: "false" })).toBe(false);
    expect(isSignupFirstBriefEnabled({ SIGNUP_FIRST_BRIEF_ENABLED: "" })).toBe(false);
    expect(isSignupFirstBriefEnabled({ SIGNUP_FIRST_BRIEF_ENABLED: "1" })).toBe(true);
    expect(isSignupFirstBriefEnabled({ SIGNUP_FIRST_BRIEF_ENABLED: "true" })).toBe(true);
    expect(isSignupFirstBriefEnabled({ SIGNUP_FIRST_BRIEF_ENABLED: "on" })).toBe(true);
    expect(isSignupFirstBriefEnabled({ SIGNUP_FIRST_BRIEF_ENABLED: "yes" })).toBe(true);
  });

  it("treats whitespace-padded truthy values as enabled", () => {
    expect(isSignupFirstBriefEnabled({ SIGNUP_FIRST_BRIEF_ENABLED: " 1 " })).toBe(true);
  });
});
