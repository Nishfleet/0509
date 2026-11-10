import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { computeBreakageEvidence } from "../../../app/lib/site/breakage-evidence";
import { breakageConfirmed } from "../../../app/lib/site/breakage-recheck.server";

const URL_UNDER_TEST = "https://recheck-brand.com/";
const BEFORE_KEY = "snapshot/site/recheck/before.txt";
const BEFORE_TEXT = "Plans from $29 a month for teams with a named manager.";
const BROKEN = computeBreakageEvidence({ status: 500, beforeText: BEFORE_TEXT, afterText: "Error" });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("breakageConfirmed", () => {
  it("confirms when the fresh read cannot reach the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await env.SNAPSHOTS.put(BEFORE_KEY, BEFORE_TEXT);
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    expect(await breakageConfirmed(BROKEN, URL_UNDER_TEST, BEFORE_KEY)).toBe(true);
  });

  it("does not confirm when the before snapshot is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("<html><body><p>Error</p></body></html>")));
    expect(await breakageConfirmed(BROKEN, URL_UNDER_TEST, "snapshot/site/recheck/missing.txt")).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("site.breakage_recheck_skipped"));
  });

  it("does not confirm when the page is over the read cap", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await env.SNAPSHOTS.put(BEFORE_KEY, BEFORE_TEXT);
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("x".repeat(5 * 1024 * 1024 + 1))));
    expect(await breakageConfirmed(BROKEN, URL_UNDER_TEST, BEFORE_KEY)).toBe(false);
  });

  it("does not confirm when the fresh read shows the page recovered", async () => {
    await env.SNAPSHOTS.put(BEFORE_KEY, BEFORE_TEXT);
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(`<html><body><p>${BEFORE_TEXT}</p></body></html>`)));
    expect(await breakageConfirmed(BROKEN, URL_UNDER_TEST, BEFORE_KEY)).toBe(false);
  });
});
