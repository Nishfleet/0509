import { describe, expect, it } from "vitest";

import { parseSlackWebhook, slackEscape } from "../app/lib/slack-webhook";

describe("parseSlackWebhook", () => {
  it("returns a valid hooks.slack.com service URL unchanged", () => {
    const url = "https://hooks.slack.com/services/T0123/B0123/abc123XYZabc123";
    expect(parseSlackWebhook(url)).toBe(url);
  });

  it("trims surrounding whitespace", () => {
    const url = "https://hooks.slack.com/services/T0123/B0123/abc123XYZ";
    expect(parseSlackWebhook(`  ${url}  `)).toBe(url);
  });

  it("rejects an http:// URL", () => {
    expect(parseSlackWebhook("http://hooks.slack.com/services/T0123/B0123/abc")).toBeNull();
  });

  it("rejects a different host", () => {
    expect(parseSlackWebhook("https://hooks.example.com/services/T0123/B0123/abc")).toBeNull();
  });

  it("rejects a missing third segment", () => {
    expect(parseSlackWebhook("https://hooks.slack.com/services/T0123/B0123")).toBeNull();
  });

  it("rejects a lowercase team id", () => {
    expect(parseSlackWebhook("https://hooks.slack.com/services/t0123/B0123/abc")).toBeNull();
  });

  it("rejects a lowercase bot id", () => {
    expect(parseSlackWebhook("https://hooks.slack.com/services/T0123/b0123/abc")).toBeNull();
  });

  it("rejects an uppercase scheme and host", () => {
    expect(parseSlackWebhook("HTTPS://HOOKS.SLACK.COM/services/T0123/B0123/abc")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(parseSlackWebhook("")).toBeNull();
  });

  it("rejects a URL with a trailing path or query string", () => {
    expect(parseSlackWebhook("https://hooks.slack.com/services/T0123/B0123/abc/extra")).toBeNull();
    expect(parseSlackWebhook("https://hooks.slack.com/services/T0123/B0123/abc?x=1")).toBeNull();
    expect(parseSlackWebhook("https://hooks.slack.com/services/T0123/B0123/abc#x")).toBeNull();
  });
});

describe("slackEscape", () => {
  it("escapes ampersands and angle brackets", () => {
    expect(slackEscape("a & <b> c")).toBe("a &amp; &lt;b&gt; c");
  });

  it("double-escapes an already-escaped ampersand", () => {
    expect(slackEscape("&amp;")).toBe("&amp;amp;");
  });

  it("returns an empty string unchanged", () => {
    expect(slackEscape("")).toBe("");
  });
});
