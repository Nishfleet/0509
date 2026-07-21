import { describe, expect, it } from "vitest";

// TEMPORARY P0 DIAGNOSTIC — remove after capture (see PR).
// Focused unit tests for the sanitized scrape-telemetry flag detector. When the
// diagnostic block is reverted, this file is removed in the same revert.
import { detectScrapeDiagV1 } from "~/lib/meta-library-browser.server";

const SEARCH_URL =
  "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=nike";

describe("detectScrapeDiagV1", () => {
  it("logs only host + path, never the query string, and reports text length", () => {
    const diag = detectScrapeDiagV1("browser_sessions", "hello world", SEARCH_URL, SEARCH_URL);
    expect(diag.schema).toBe("scrape_diag_v1");
    expect(diag.step).toBe("browser_sessions");
    expect(diag.finalUrlHost).toBe("www.facebook.com");
    expect(diag.finalUrlPath).toBe("/ads/library/");
    // The serialized diag must not leak the query string (which carries the term).
    expect(JSON.stringify(diag)).not.toContain("q=nike");
    expect(JSON.stringify(diag)).not.toContain("nike");
    expect(diag.pageTextLength).toBe("hello world".length);
  });

  it("detects a Facebook login wall", () => {
    const text =
      "You must log in to continue. Log into Facebook to see more from this advertiser.";
    const flags = detectScrapeDiagV1("browser_sessions", text, SEARCH_URL, SEARCH_URL).flags;
    expect(flags.loginWall).toBe(true);
    expect(flags.consentOverlay).toBe(false);
    expect(flags.explicitNoResults).toBe(false);
    expect(flags.captchaOrCheckpoint).toBe(false);
  });

  it("does not flag a login wall on ordinary result copy", () => {
    const flags = detectScrapeDiagV1(
      "browser_sessions",
      "Sponsored — Nike Air Max. Shop now on facebook.",
      SEARCH_URL,
      SEARCH_URL,
    ).flags;
    expect(flags.loginWall).toBe(false);
  });

  it("detects a cookie-consent overlay", () => {
    const text = "We use cookies to personalize content. Allow all cookies or manage choices.";
    const flags = detectScrapeDiagV1("browser_sessions", text, SEARCH_URL, SEARCH_URL).flags;
    expect(flags.consentOverlay).toBe(true);
  });

  it("detects the Ad Library explicit no-results state", () => {
    const flags = detectScrapeDiagV1(
      "browser_sessions",
      "No ads found for your search. Try a different term.",
      SEARCH_URL,
      SEARCH_URL,
    ).flags;
    expect(flags.explicitNoResults).toBe(true);
  });

  it("detects a captcha / checkpoint / security check", () => {
    expect(
      detectScrapeDiagV1("browser_sessions", "Security check required.", SEARCH_URL, SEARCH_URL)
        .flags.captchaOrCheckpoint,
    ).toBe(true);
    expect(
      detectScrapeDiagV1("browser_sessions", "Please complete this checkpoint.", SEARCH_URL, SEARCH_URL)
        .flags.captchaOrCheckpoint,
    ).toBe(true);
  });

  it("flags a redirect when the final host differs from the requested host", () => {
    const flags = detectScrapeDiagV1(
      "browser_sessions",
      "",
      SEARCH_URL,
      "https://www.facebook.com/login/?next=%2Fads%2Flibrary",
    ).flags;
    expect(flags.redirected).toBe(true);
  });

  it("flags a redirect when the final path differs from the requested path", () => {
    const flags = detectScrapeDiagV1(
      "browser_sessions",
      "",
      SEARCH_URL,
      "https://www.facebook.com/checkpoint/",
    ).flags;
    expect(flags.redirected).toBe(true);
  });

  it("does not flag a redirect for a trailing-slash-only difference on the same page", () => {
    const flags = detectScrapeDiagV1(
      "browser_sessions",
      "",
      "https://www.facebook.com/ads/library/?q=nike",
      "https://www.facebook.com/ads/library?country=US",
    ).flags;
    expect(flags.redirected).toBe(false);
  });

  it("returns all-false flags for a clean, populated results page", () => {
    const flags = detectScrapeDiagV1(
      "browser_sessions",
      "Sponsored\nActive\nLibrary ID: 123\nStarted running on Jan 1, 2026",
      SEARCH_URL,
      SEARCH_URL,
    ).flags;
    expect(flags).toEqual({
      loginWall: false,
      consentOverlay: false,
      explicitNoResults: false,
      captchaOrCheckpoint: false,
      redirected: false,
    });
  });

  it("tolerates a malformed final URL without throwing", () => {
    const diag = detectScrapeDiagV1("browser_sessions", "text", SEARCH_URL, "not a url");
    expect(diag.finalUrlHost).toBe("");
    // requested host is real, final host is empty → treated as redirected.
    expect(diag.flags.redirected).toBe(true);
  });
});
