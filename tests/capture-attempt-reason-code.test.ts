import { describe, expect, it } from "vitest";

import {
  CAPTURE_ATTEMPT_REASON_CODES,
  formatCaptureAttemptReasonLabel,
  toPublicCaptureStatus,
  toPublicReasonCode,
} from "~/lib/capture-attempt-reason-code";

/**
 * Issue #1289: the public run-history reason-code vocabulary. Every internal
 * failure code / skip reason the proof pipeline writes must map to exactly
 * one public reason code (or `null` for succeeded), and the issue's named
 * set must all be representable.
 */

const ISSUE_REQUIRED_REASON_CODES = [
  "bot_wall",
  "cloudflare_challenge",
  "cookie_banner",
  "partial_load",
  "error_page",
  "timeout",
  "takedown_restore",
  "budget_skip",
  "extraction_failed",
] as const;

describe("toPublicReasonCode", () => {
  it("maps each issue-required public code from at least one internal code", () => {
    const internalCodes: Record<string, string> = {
      bot_wall: "landing_blocked",
      cloudflare_challenge: "landing_challenge_page",
      cookie_banner: "landing_cookie_wall",
      partial_load: "landing_partial_spa",
      error_page: "landing_error_page",
      timeout: "landing_fetch_failed",
      takedown_restore: "landing_error_page",
      budget_skip: "skipped_due_to_budget",
      extraction_failed: "landing_content_signature_too_small",
    };

    for (const publicCode of ISSUE_REQUIRED_REASON_CODES) {
      const internal = internalCodes[publicCode];
      const options =
        publicCode === "takedown_restore" ? { isTakedownRestore: true } : {};
      expect(toPublicReasonCode(internal, options), `internal "${internal}" -> ${publicCode}`).toBe(
        publicCode,
      );
    }
  });

  it("every issue-required code is in the exported vocabulary", () => {
    for (const code of ISSUE_REQUIRED_REASON_CODES) {
      expect(CAPTURE_ATTEMPT_REASON_CODES).toContain(code);
    }
  });

  it("maps the landing_* family deterministically", () => {
    expect(toPublicReasonCode("landing_challenge_page")).toBe("cloudflare_challenge");
    expect(toPublicReasonCode("landing_cookie_wall")).toBe("cookie_banner");
    expect(toPublicReasonCode("landing_partial_spa")).toBe("partial_load");
    expect(toPublicReasonCode("landing_error_page")).toBe("error_page");
    expect(toPublicReasonCode("landing_http_error")).toBe("error_page");
    expect(toPublicReasonCode("landing_blocked")).toBe("bot_wall");
    expect(toPublicReasonCode("landing_redirect_blocked")).toBe("bot_wall");
    expect(toPublicReasonCode("landing_rate_limited")).toBe("timeout");
    expect(toPublicReasonCode("landing_fetch_failed")).toBe("timeout");
    expect(toPublicReasonCode("landing_redirect_limit")).toBe("timeout");
    expect(toPublicReasonCode("landing_content_empty_or_oversized")).toBe("extraction_failed");
    expect(toPublicReasonCode("landing_url_invalid")).toBe("extraction_failed");
    expect(toPublicReasonCode("proof_capture_failed")).toBe("extraction_failed");
  });

  it("maps skipped_due_to_budget to budget_skip", () => {
    expect(toPublicReasonCode("skipped_due_to_budget")).toBe("budget_skip");
  });

  it("flips an error_page capture to takedown_restore only with the restore signal", () => {
    expect(toPublicReasonCode("landing_error_page")).toBe("error_page");
    expect(toPublicReasonCode("landing_error_page", { isTakedownRestore: true })).toBe(
      "takedown_restore",
    );
    // A non-error code is not flipped to takedown_restore.
    expect(toPublicReasonCode("landing_challenge_page", { isTakedownRestore: true })).toBe(
      "takedown_restore",
    );
  });

  it("returns null for empty or unclassifiable codes, never throws", () => {
    expect(toPublicReasonCode(null)).toBeNull();
    expect(toPublicReasonCode("")).toBeNull();
    expect(toPublicReasonCode("   ")).toBeNull();
    expect(toPublicReasonCode("some_future_unknown_code")).toBeNull();
  });
});

describe("toPublicCaptureStatus", () => {
  it("maps succeeded and budget-skip verbatim, everything else to capture_failed", () => {
    expect(toPublicCaptureStatus("succeeded")).toBe("succeeded");
    expect(toPublicCaptureStatus("skipped_due_to_budget")).toBe("skipped_due_to_budget");
    expect(toPublicCaptureStatus("failed")).toBe("capture_failed");
    expect(toPublicCaptureStatus("skipped_due_to_rate_limit")).toBe("capture_failed");
    expect(toPublicCaptureStatus("skipped_due_to_dedupe")).toBe("capture_failed");
    expect(toPublicCaptureStatus("pending")).toBe("capture_failed");
  });
});

describe("formatCaptureAttemptReasonLabel", () => {
  it("returns a human label for every public reason code", () => {
    for (const code of CAPTURE_ATTEMPT_REASON_CODES) {
      const label = formatCaptureAttemptReasonLabel(code);
      expect(label, `label for ${code}`).toBeTruthy();
      expect(label.length).toBeGreaterThan(3);
    }
  });

  it("returns a fallback label for null", () => {
    expect(formatCaptureAttemptReasonLabel(null)).toMatch(/did not produce/i);
  });
});
