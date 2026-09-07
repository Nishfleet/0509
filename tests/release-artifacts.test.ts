import { describe, expect, it } from "vitest";

import { attachReleaseStateArtifacts } from "../e2e/helpers/release-artifacts";

describe("attachReleaseStateArtifacts", () => {
  it("takes the release screenshot without mutating the DOM", async () => {
    // Issue #1752: caret:"hide" makes Playwright write
    // style="caret-color:transparent !important" on every input/textarea/
    // [contenteditable] element, then restore it. When that lands while React
    // hydration is still in flight (dev release server, module graph still
    // loading), the hydration diff reports an extra style attribute and the
    // strict proof fails on browser_hydration_error:console. "initial" leaves
    // the DOM untouched.
    const screenshotOptions: Array<Record<string, unknown>> = [];
    const attachments: string[] = [];
    const page = {
      viewportSize: () => ({ width: 375, height: 812 }),
      evaluate: async () => undefined,
      screenshot: async (options: Record<string, unknown>) => {
        screenshotOptions.push(options);
        return Buffer.from("png", "utf8");
      },
      locator: () => ({
        ariaSnapshotJSON: async () => [{ role: "generic", name: "evidence" }],
      }),
    };
    const testInfo = {
      attach: async (name: string) => {
        attachments.push(name);
      },
    };

    await attachReleaseStateArtifacts({
      page: page as never,
      testInfo: testInfo as never,
      prefix: "j1",
      state: "home",
    });

    expect(screenshotOptions).toHaveLength(1);
    expect(screenshotOptions[0].caret).toBe("initial");
    expect(attachments).toEqual([
      "j1-375x812-home.png",
      "j1-375x812-home.aria.json",
    ]);
  });
});
