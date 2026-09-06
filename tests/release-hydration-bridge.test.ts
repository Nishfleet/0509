import { describe, expect, it } from "vitest";

import { installReleaseHydrationBridge } from "../e2e/helpers/release-test";

class FakePage {
  private readonly listeners = new Map<string, Set<(value: never) => void>>();

  url() {
    return "http://127.0.0.1:4179/app/watchlists?watchlist=e2e-1&token=must-stay-secret";
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
}

function hydrationDetails(testInfo: {
  annotations: Array<{ type: string; description?: string }>;
}) {
  return testInfo.annotations
    .filter((annotation) => annotation.type === "reactHydrationErrorDetail")
    .map((annotation) => JSON.parse(annotation.description ?? "{}"));
}

describe("release hydration bridge", () => {
  it("records safe, deduplicated annotations for browser hydration failures", () => {
    const page = new FakePage();
    const testInfo = {
      annotations: [] as Array<{ type: string; description?: string }>,
      title: "Gate-B Journey 3: monitoring loop (mobile)",
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

    expect(
      testInfo.annotations.filter((annotation) => annotation.type === "reactHydrationError"),
    ).toEqual([
      { type: "reactHydrationError", description: "console" },
      { type: "reactHydrationError", description: "pageerror" },
    ]);
    const details = hydrationDetails(testInfo);
    expect(details).toHaveLength(2);
    expect(details[0]).toEqual({
      source: "console",
      message: "Hydration failed because the server rendered text did not match the client",
      url: "/app/watchlists?watchlist=e2e-1",
      title: "Gate-B Journey 3: monitoring loop (mobile)",
    });
    expect(details[1].source).toBe("pageerror");
    expect(details[1].message).toContain("tree hydrated but some attributes");
    cleanup();
  });

  it("strips secrets, control characters and sensitive query params from captured detail", () => {
    const page = new FakePage();
    const testInfo = {
      annotations: [] as Array<{ type: string; description?: string }>,
      title: "Gate-B Journey 5: billing (desktop)",
    };
    installReleaseHydrationBridge(page as never, testInfo as never);

    page.emit("console", {
      type: () => "error",
      text: () =>
        `[31mHydration failed because the initial UI does not match token=sk_live_abc123def456\nnext line`,
    });

    const [detail] = hydrationDetails(testInfo);
    expect(detail.source).toBe("console");
    expect(detail.message).not.toContain("sk_live_");
    expect(detail.message).toContain("[redacted]");
    expect(detail.message).not.toContain("\n");
    expect(detail.url).toBe("/app/watchlists?watchlist=e2e-1");
  });

  it("caps the captured message at 300 characters", () => {
    const page = new FakePage();
    const testInfo = {
      annotations: [] as Array<{ type: string; description?: string }>,
      title: "t",
    };
    installReleaseHydrationBridge(page as never, testInfo as never);

    page.emit("console", {
      type: () => "error",
      text: () => `Hydration failed because the server rendered ${"x".repeat(600)}`,
    });

    const [detail] = hydrationDetails(testInfo);
    expect(detail.message.length).toBeLessThanOrEqual(300);
  });

  it("ignores ordinary browser errors and non-error console messages", () => {
    const page = new FakePage();
    const testInfo = { annotations: [] as Array<{ type: string; description?: string }> };
    installReleaseHydrationBridge(page as never, testInfo as never);

    page.emit("console", { type: () => "warning", text: () => "Hydration failed because the server rendered" });
    page.emit("console", { type: () => "error", text: () => "Expected provider denial in retention fixture" });
    page.emit("pageerror", new Error("ordinary fixture exception"));

    expect(testInfo.annotations).toEqual([]);
  });
});
