import { describe, expect, it } from "vitest";

import { redactUrlUserinfo } from "../scripts/provider-bakeoff.cdp.mjs";

describe("redactUrlUserinfo", () => {
  it("removes userinfo from a URL with credentials, keeping the host", () => {
    const redacted = redactUrlUserinfo("wss://user:pass@host:9222");
    expect(redacted).toContain("host");
    expect(redacted).not.toContain("user");
    expect(redacted).not.toContain("pass");
  });

  it("keeps the host and port for diagnosis", () => {
    const redacted = redactUrlUserinfo("wss://user:pass@host:9222");
    expect(redacted).toContain("wss://host:9222");
  });

  it("leaves a URL without userinfo unchanged", () => {
    const url = "wss://host:9222";
    expect(redactUrlUserinfo(url)).toBe(url);
  });

  it("returns the input unchanged when it does not parse as a URL", () => {
    const notAUrl = "not-a-url";
    expect(redactUrlUserinfo(notAUrl)).toBe(notAUrl);
  });
});
