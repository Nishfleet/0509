import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: { SNAPSHOTS: { put: vi.fn() } } }));

import { resolveLogo } from "../../app/lib/identity/logo-cascade";
import { storeLogo } from "../../app/lib/identity/logo-store.server";
import { readWatchConfig } from "../../app/lib/mentions/youtube-channel";
import { httpUrl } from "../../app/lib/http-url";
import { canonicalTimezone } from "../../app/lib/timezone";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function lastEvent(spy: ReturnType<typeof vi.spyOn>): string | null {
  const call = spy.mock.calls.at(-1);
  if (call === undefined) return null;
  const parsed: unknown = JSON.parse(String(call[0]));
  if (typeof parsed !== "object" || parsed === null || !("event" in parsed)) return null;
  return String((parsed as { event: unknown }).event);
}

describe("bare catch failure lines", () => {
  it("resolveLogo logs identity.logo_probe_failed and still continues", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("dns")));
    const result = await resolveLogo({
      ldOrganizationLogo: "https://a.test/logo.png",
      ogImage: null,
      appleTouchIcon: null,
      registrableDomain: "a.test",
    });
    expect(result).toEqual({ ok: false, reason: "no_logo" });
    expect(lastEvent(spy)).toBe("identity.logo_probe_failed");
  });

  it("storeLogo logs identity.logo_url_parse_failed and still returns null", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(storeLogo("a.test", "not a url")).resolves.toBeNull();
    expect(lastEvent(spy)).toBe("identity.logo_url_parse_failed");
  });

  it("readWatchConfig logs mentions.youtube_channel_json_parse_failed and still returns unreadable", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(readWatchConfig("{").status).toBe("unreadable");
    expect(lastEvent(spy)).toBe("mentions.youtube_channel_json_parse_failed");
  });

  it("httpUrl logs http_url.parse_failed and still returns null", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(httpUrl("not a url")).toBeNull();
    expect(lastEvent(spy)).toBe("http_url.parse_failed");
  });

  it("canonicalTimezone logs timezone.resolve_failed and still returns UTC", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(canonicalTimezone("Not/AZone")).toBe("UTC");
    expect(lastEvent(spy)).toBe("timezone.resolve_failed");
  });
});
