import { describe, expect, it } from "vitest";

import { TURNSTILE_RENDER_OPTIONS } from "../app/components/turnstile-widget";

describe("the sign-in Turnstile widget (WCAG 2.1.1 keyboard, 3.3.8 accessible authentication)", () => {
  it("stays hidden unless Cloudflare needs the visitor, and then can be reached with Tab", () => {
    expect(TURNSTILE_RENDER_OPTIONS.appearance).toBe("interaction-only");
    expect(TURNSTILE_RENDER_OPTIONS.tabindex).toBe(0);
  });

  it("names the form field the server reads", () => {
    expect(TURNSTILE_RENDER_OPTIONS["response-field-name"]).toBe("cf-turnstile-response");
  });
});
