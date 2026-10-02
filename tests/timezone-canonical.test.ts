import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalTimezone } from "../app/lib/timezone";

describe("canonicalTimezone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a zone Intl accepts, trimmed", () => {
    expect(canonicalTimezone("Europe/London")).toBe("Europe/London");
    expect(canonicalTimezone("  Asia/Kolkata  ")).toBe("Asia/Kolkata");
  });

  it("returns UTC for a missing, empty or whitespace-only value", () => {
    expect(canonicalTimezone(null)).toBe("UTC");
    expect(canonicalTimezone(undefined)).toBe("UTC");
    expect(canonicalTimezone("")).toBe("UTC");
    expect(canonicalTimezone("   ")).toBe("UTC");
  });

  it("returns UTC for a value over the 100 character limit", () => {
    expect(canonicalTimezone("x".repeat(101))).toBe("UTC");
  });

  it("returns UTC and logs one timezone.resolve_failed line for a zone Intl rejects", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(canonicalTimezone("Not/AZone")).toBe("UTC");

    expect(error).toHaveBeenCalledOnce();
    const logged = JSON.parse(String(error.mock.calls[0]?.[0])) as { event: string };
    expect(logged.event).toBe("timezone.resolve_failed");
  });
});
