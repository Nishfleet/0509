import { describe, expect, it } from "vitest";

import {
  parseSiteInput,
  SITE_INVALID_ERROR,
  SITE_LINK_MAX,
  SITE_SAME_ERROR,
  SITE_TOO_LONG_ERROR,
} from "../../../app/lib/competitor-site";

describe("a website the customer adds for a competitor", () => {
  it("accepts a bare domain or an address and keeps host and path only", () => {
    expect(parseSiteInput("adidas-group.com", "adidas.com")).toEqual({ ok: true, url: "https://adidas-group.com/" });
    expect(parseSiteInput(" http://www.adidas-group.com/en/media?x=1#top ", "adidas.com")).toEqual({
      ok: true,
      url: "https://www.adidas-group.com/en/media",
    });
  });

  it("refuses the brand's own domain, whatever the host", () => {
    expect(parseSiteInput("news.adidas.com", "www.adidas.com")).toEqual({ ok: false, message: SITE_SAME_ERROR });
  });

  it("refuses anything that is not a public web address", () => {
    for (const raw of [
      "",
      "not a site",
      "ftp://adidas-group.com",
      "10.0.0.1",
      "localhost",
      "https://user:pw@adidas-group.com",
      "javascript:alert(1)",
    ]) {
      expect(parseSiteInput(raw, "adidas.com")).toEqual({ ok: false, message: SITE_INVALID_ERROR });
    }
  });

  it("refuses an over-long address", () => {
    expect(parseSiteInput(`${"a".repeat(SITE_LINK_MAX)}.com`, "adidas.com")).toEqual({
      ok: false,
      message: SITE_TOO_LONG_ERROR,
    });
  });
});
