import { describe, expect, it } from "vitest";

import { installReleaseHydrationBridge } from "../e2e/helpers/release-test";

class FakePage {
  private readonly listeners = new Map<string, Set<(value: never) => void>>();

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

describe("release hydration bridge", () => {
  it("records safe, deduplicated annotations for browser hydration failures", () => {
    const page = new FakePage();
    const testInfo = { annotations: [] as Array<{ type: string; description?: string }> };
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

    expect(testInfo.annotations).toEqual([
      { type: "reactHydrationError", description: "console" },
      { type: "reactHydrationError", description: "pageerror" },
    ]);
    expect(JSON.stringify(testInfo.annotations)).not.toContain("server rendered text");
    cleanup();
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
