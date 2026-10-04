import { describe, expect, it } from "vitest";

import { timezoneCookie, timezoneCookieValue } from "../app/lib/timezone";

describe("timezoneCookie", () => {
  it('is a cookie named "timezone"', () => {
    expect(timezoneCookie.name).toBe("timezone");
  });

  it("serializes a value as a year-long, site-wide, lax cookie", async () => {
    const header = await timezoneCookie.serialize("Europe/London");
    expect(header.startsWith("timezone=")).toBe(true);
    expect(header).toContain("Path=/");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Max-Age=31536000");
  });
});

describe("timezoneCookieValue", () => {
  it("rejects a null header", async () => {
    expect(await timezoneCookieValue(null)).toBeNull();
  });

  it("rejects a blank or serialized-empty header", async () => {
    expect(await timezoneCookieValue("")).toBeNull();
    const empty = await timezoneCookie.serialize("");
    expect(await timezoneCookieValue(empty)).toBeNull();
  });

  it("trims a serialized value and keeps a real zone", async () => {
    const header = await timezoneCookie.serialize("  Asia/Kolkata  ");
    expect(await timezoneCookieValue(header)).toBe("Asia/Kolkata");
  });

  it("ignores a header that carries no timezone cookie", async () => {
    expect(await timezoneCookieValue("other=1")).toBeNull();
  });
});
