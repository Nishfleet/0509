import { describe, expect, it, vi } from "vitest";

import { httpUrl } from "../app/lib/http-url";

// httpUrl decides whether a stored string becomes an href, so every branch of
// app/lib/http-url.ts is pinned here: the empty-value early return, the
// successful parse, the parse failure that logs, and the protocol allow-list
// that keeps javascript: and data: out of an href.
describe("httpUrl", () => {
  it("returns null for an empty or whitespace-only value without logging", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(httpUrl("")).toBeNull();
      expect(httpUrl("   \t\n ")).toBeNull();
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("trims the stored value and returns the normalised href", () => {
    expect(httpUrl(" https://rival.com/pricing ")).toBe("https://rival.com/pricing");
  });

  it("normalises a bare origin to its trailing-slash form", () => {
    expect(httpUrl("http://rival.com")).toBe("http://rival.com/");
  });

  it("returns null and logs one http_url.parse_failed line when the value does not parse", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(httpUrl("not a url")).toBeNull();
      expect(httpUrl("rival.com")).toBeNull();
      expect(error).toHaveBeenCalledTimes(2);
      const logged = JSON.parse(String(error.mock.calls[0]?.[0])) as {
        event: string;
        error: string;
      };
      expect(logged.event).toBe("http_url.parse_failed");
      expect(logged.error.length).toBeGreaterThan(0);
    } finally {
      error.mockRestore();
    }
  });

  it("rejects a non-http protocol that parses cleanly, with no parse_failed log", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(httpUrl("javascript:alert(1)")).toBeNull();
      expect(httpUrl("data:text/html,x")).toBeNull();
      expect(httpUrl("ftp://rival.com")).toBeNull();
      expect(httpUrl("mailto:a@b.co")).toBeNull();
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
