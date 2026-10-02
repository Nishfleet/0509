import { describe, expect, it } from "vitest";

import { parseSlackWebhook, slackEscape } from "../../app/lib/slack-webhook";

describe("Slack webhook address", () => {
  it("accepts a Slack incoming webhook and trims it", () => {
    const url = "https://hooks.slack.com/services/T0123ABC/B0456DEF/abcDEF123456";
    expect(parseSlackWebhook(`  ${url}\n`)).toBe(url);
  });

  it.each([
    "http://hooks.slack.com/services/T0123ABC/B0456DEF/abc123",
    "https://hooks.slack.com.evil.example/services/T0123ABC/B0456DEF/abc123",
    "https://evil.example/https://hooks.slack.com/services/T0123ABC/B0456DEF/abc123",
    "https://hooks.slack.com/services/T0123ABC/B0456DEF/abc123?x=1",
    "https://hooks.slack.com/services/T0123ABC/B0456DEF",
    "https://internal.example/hook",
    "",
  ])("refuses %s", (value) => {
    expect(parseSlackWebhook(value)).toBeNull();
  });

  it("escapes what a rival's page said so it cannot add Slack links", () => {
    expect(slackEscape("<https://evil.example|click> & more")).toBe("&lt;https://evil.example|click&gt; &amp; more");
  });
});
