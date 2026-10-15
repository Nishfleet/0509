import { describe, expect, it } from "vitest";

import { checkUrl } from "../app/lib/healthcheck.server";

const KEY = "k".repeat(12);

describe("checkUrl", () => {
  it("makes the ok ping the bare slug and start and fail sub-paths, creating the check on first use", () => {
    expect(checkUrl(KEY, "site-sweep", "ok")).toBe(`https://hc-ping.com/${KEY}/site-sweep?create=1`);
    expect(checkUrl(KEY, "site-sweep", "start")).toBe(`https://hc-ping.com/${KEY}/site-sweep/start?create=1`);
    expect(checkUrl(KEY, "site-sweep", "fail")).toBe(`https://hc-ping.com/${KEY}/site-sweep/fail?create=1`);
  });

  it("is silent without a key, so an unconfigured Worker sends nothing", () => {
    expect(checkUrl(null, "site-sweep", "ok")).toBeNull();
  });

  it("refuses a key or slug that could change the path", () => {
    expect(checkUrl("a/b/c/d/e/f/g/h", "site-sweep", "ok")).toBeNull();
    expect(checkUrl(KEY, "../x", "ok")).toBeNull();
    expect(checkUrl(KEY, "Site Sweep", "ok")).toBeNull();
    expect(checkUrl("short", "site-sweep", "ok")).toBeNull();
  });
});
