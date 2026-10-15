import { describe, expect, it } from "vitest";

import { deviceLabel } from "../app/lib/device-label";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

describe("deviceLabel", () => {
  it.each([
    [CHROME_MAC, "Chrome on Mac"],
    [SAFARI_IPHONE, "Safari on iPhone"],
    [EDGE_WINDOWS, "Edge on Windows"],
    [FIREFOX_LINUX, "Firefox on Linux"],
    [CHROME_ANDROID, "Chrome on Android"],
  ])("names %s", (userAgent, label) => {
    expect(deviceLabel(userAgent)).toBe(label);
  });

  it("does not guess when there is no user agent or nothing is recognised", () => {
    expect(deviceLabel(null)).toBe("Unknown device");
    expect(deviceLabel("curl/8.0")).toBe("Unknown device");
  });
});
