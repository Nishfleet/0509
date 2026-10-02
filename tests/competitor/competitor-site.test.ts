import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { SITE_INVALID_ERROR, SITE_LINK_MAX, SITE_SAME_ERROR, SITE_TOO_LONG_ERROR } from "../../app/lib/competitor-site";
import { parseSiteInput } from "../../app/lib/competitor-site.server";

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
    const refused = [
      "",
      "not a site",
      "ftp://adidas-group.com",
      "javascript:alert(1)",
      "https://user:pw@adidas-group.com",
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "[::1]",
      "[::ffff:7f00:1]",
      "2130706433",
      "0177.0.0.1",
      "localhost",
      "metadata.internal",
      "printer.local",
    ];
    for (const raw of refused) {
      expect(parseSiteInput(raw, "adidas.com"), raw).toEqual({ ok: false, message: SITE_INVALID_ERROR });
    }
  });

  it("drops a port and an http scheme rather than following them", () => {
    expect(parseSiteInput("http://adidas-group.com:8080/en/", "adidas.com")).toEqual({
      ok: true,
      url: "https://adidas-group.com/en/",
    });
  });

  it("refuses an over-long address", () => {
    expect(parseSiteInput(`${"a".repeat(SITE_LINK_MAX)}.com`, "adidas.com")).toEqual({
      ok: false,
      message: SITE_TOO_LONG_ERROR,
    });
  });
});
