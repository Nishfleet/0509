import { describe, expect, it } from "vitest";

import {
  appOrigin,
  isFullSiteWatchAllowedForHost,
  isFullSiteWatchEnabled,
  isSignupFirstBriefEnabled,
  isWhatsAppWebhookConfigured,
  parseFullSiteWatchCanaryHosts,
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

  it("rejects a Forwarded proto outside http/https and falls back to request.url", () => {
    const request = new Request("http://localhost/", {
      headers: { forwarded: "for=192.0.2.1;proto=javascript;host=evil.example" },
    });

    expect(appOrigin({}, request)).toBe("http://localhost");
  });

  it("rejects a Forwarded host that is not a bare hostname", () => {
    const withCredentials = new Request("http://localhost/", {
      headers: { forwarded: "for=192.0.2.1;proto=https;host=0509.io@evil.example" },
    });
    const withPath = new Request("http://localhost/", {
      headers: { forwarded: "for=192.0.2.1;proto=https;host=evil.example/phish" },
    });

    expect(appOrigin({}, withCredentials)).toBe("http://localhost");
    expect(appOrigin({}, withPath)).toBe("http://localhost");
  });

  it("rejects spoofed x-forwarded proto and host the same way", () => {
    const badProto = new Request("http://localhost/", {
      headers: {
        "x-forwarded-proto": "javascript",
        "x-forwarded-host": "evil.example",
      },
    });
    const badHost = new Request("http://localhost/", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "0509.io@evil.example",
      },
    });

    expect(appOrigin({}, badProto)).toBe("http://localhost");
    expect(appOrigin({}, badHost)).toBe("http://localhost");
  });

  it("keeps a forwarded host carrying an explicit port", () => {
    const request = new Request("http://localhost/", {
      headers: { forwarded: "for=192.0.2.1;proto=https;host=0509.io:443" },
    });

    expect(appOrigin({}, request)).toBe("https://0509.io:443");
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

describe("Full-Site Watch canary host gate", () => {
  it("is off when the flag is absent", () => {
    expect(isFullSiteWatchEnabled({})).toBe(false);
    expect(
      isFullSiteWatchAllowedForHost({}, "https://www.nike.com/"),
    ).toBe(false);
  });

  it("lets every host through when the flag is on and the canary list is empty", () => {
    const env = { FULLSITE_WATCH_ENABLED: "true" };
    expect(isFullSiteWatchEnabled(env)).toBe(true);
    expect(parseFullSiteWatchCanaryHosts(env)).toEqual([]);
    expect(isFullSiteWatchAllowedForHost(env, "https://nykaa.com/")).toBe(true);
  });

  it("restricts scans to the canary hosts when a list is set", () => {
    const env = {
      FULLSITE_WATCH_ENABLED: "true",
      FULLSITE_WATCH_CANARY_HOSTS: "nike.com www.nike.com",
    };
    expect(parseFullSiteWatchCanaryHosts(env)).toEqual(["nike.com"]);
    expect(isFullSiteWatchAllowedForHost(env, "https://www.nike.com/")).toBe(true);
    expect(isFullSiteWatchAllowedForHost(env, "https://nike.com/in")).toBe(true);
    expect(isFullSiteWatchAllowedForHost(env, "https://shop.nike.com/")).toBe(true);
    expect(isFullSiteWatchAllowedForHost(env, "https://www.nykaa.com/")).toBe(false);
  });
});
