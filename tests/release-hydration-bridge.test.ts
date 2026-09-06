import { describe, expect, it } from "vitest";

import { installReleaseHydrationBridge } from "../e2e/helpers/release-test";

class FakePage {
  private readonly listeners = new Map<string, Set<(value: never) => void>>();
  private urlValue: string;

  constructor(url = "http://127.0.0.1:4179/app/watchlists") {
    this.urlValue = url;
  }

  on(event: string, listener: (value: never) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: (value: never) => void) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, value: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(value as never);
  }

  url() {
    return this.urlValue;
  }
}

function parseDetail(description: unknown) {
  return typeof description === "string" ? JSON.parse(description) : null;
}

describe("release hydration bridge", () => {
  it("records safe, deduplicated annotations for browser hydration failures", () => {
    const page = new FakePage("http://127.0.0.1:4179/app/watchlists?watchlist=e2e-watchlist-1");
    const testInfo = {
      annotations: [] as Array<{ type: string; description?: string }>,
      title: "watchlist board renders the proof age",
    };
    const cleanup = installReleaseHydrationBridge(page as never, testInfo as never);

    page.emit("console", {
      type: () => "error",
      text: () => "Hydration failed because the server rendered text did not match the client",
    });
    page.emit("console", {
      type: () => "error",
      text: () => "Hydration failed because the server rendered text did not match the client",
    });
    page.emit("pageerror", new Error("A tree hydrated but some attributes of the server rendered HTML differed"));
    page.emit("pageerror", new Error(
      "Minified React error #418; visit https://react.dev/errors/418?args[]=HTML for the full message",
    ));

    const sourceAnnotations = testInfo.annotations.filter((a) => a.type === "reactHydrationError");
    const detailAnnotations = testInfo.annotations.filter((a) => a.type === "reactHydrationErrorDetail");
    expect(sourceAnnotations).toEqual([
      { type: "reactHydrationError", description: "console" },
      { type: "reactHydrationError", description: "pageerror" },
    ]);
    // One detail per source, each carrying message/url/title.
    expect(detailAnnotations).toHaveLength(2);
    const consoleDetail = parseDetail(detailAnnotations[0]?.description);
    expect(consoleDetail).toMatchObject({
      source: "console",
      url: "http://127.0.0.1:4179/app/watchlists?watchlist=e2e-watchlist-1",
      title: "watchlist board renders the proof age",
    });
    expect(consoleDetail?.message).toContain("server rendered text did not match");
    const pageErrorDetail = parseDetail(detailAnnotations[1]?.description);
    expect(pageErrorDetail).toMatchObject({
      source: "pageerror",
      url: "http://127.0.0.1:4179/app/watchlists?watchlist=e2e-watchlist-1",
      title: "watchlist board renders the proof age",
    });
    expect(pageErrorDetail?.message).toContain("A tree hydrated but some attributes");
    // No raw message text leaks into the source annotation descriptions.
    expect(JSON.stringify(sourceAnnotations)).not.toContain("server rendered text");
    cleanup();
  });

  it("redacts secret-like substrings and truncates the message to 300 chars", () => {
    const page = new FakePage();
    const testInfo = {
      annotations: [] as Array<{ type: string; description?: string }>,
      title: "secret scrubbing",
    };
    installReleaseHydrationBridge(page as never, testInfo as never);

    const longBody = `api_key=sk_live_secret123 ${"x".repeat(400)}`;
    page.emit("console", {
      type: () => "error",
      text: () => `Hydration failed because the server rendered text did not match. ${longBody}`,
    });

    const detail = parseDetail(
      testInfo.annotations.find((a) => a.type === "reactHydrationErrorDetail")?.description,
    );
    expect(detail?.message.length).toBeLessThanOrEqual(300);
    expect(detail?.message).not.toContain("sk_live_secret123");
    expect(detail?.message).toContain("[redacted]");
  });

  it("redacts secret-like substrings in the recorded page url and title", () => {
    const page = new FakePage("http://127.0.0.1:4179/app?token=sk_live_secreturl&api_key=secretkey");
    const testInfo = {
      annotations: [] as Array<{ type: string; description?: string }>,
      title: "url scrubbing",
    };
    installReleaseHydrationBridge(page as never, testInfo as never);

    page.emit("console", {
      type: () => "error",
      text: () => "Hydration failed because the server rendered text did not match the client",
    });

    const detail = parseDetail(
      testInfo.annotations.find((a) => a.type === "reactHydrationErrorDetail")?.description,
    );
    expect(detail?.url).not.toContain("sk_live_secreturl");
    expect(detail?.url).not.toContain("secretkey");
    expect(detail?.url).toContain("[redacted]");
  });

  it("ignores ordinary browser errors and non-error console messages", () => {
    const page = new FakePage();
    const testInfo = {
      annotations: [] as Array<{ type: string; description?: string }>,
      title: "ignores ordinary errors",
    };
    installReleaseHydrationBridge(page as never, testInfo as never);

    page.emit("console", { type: () => "warning", text: () => "Hydration failed because the server rendered" });
    page.emit("console", { type: () => "error", text: () => "Expected provider denial in retention fixture" });
    page.emit("pageerror", new Error("ordinary fixture exception"));

    expect(testInfo.annotations).toEqual([]);
  });
});
