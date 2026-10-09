import { describe, expect, it } from "vitest";

import { lintExisting, lintTextAt } from "./eslint-lint-text";

// J5 on the 11:01Z full suite sat on an empty status for 45 s because the
// browser read in app/lib/site/browser-budget.server.ts awaited quickAction with
// no limit. #7296 and #7300 bound every call there; BARE_BROWSER_CALL in
// eslint.config.js makes a new unbounded call site red instead of a review
// note. These probes boot the real eslint.config.js, the same rig as
// eslint-fetch-rule.test.ts.

const BROWSER_MESSAGE = "Browser Rendering calls go through app/lib/site/browser-budget.server.ts";

const BARE_CALL = `import { env } from "cloudflare:workers";

export async function probe(): Promise<Response> {
  return env.BROWSER.quickAction("content", { url: "https://example.com/" });
}
`;

describe("eslint one-browser-call rule (#7296)", () => {
  it("rejects a bare quickAction( in app/lib", { timeout: 60_000 }, async () => {
    const result = await lintTextAt("app/lib/cadence.ts", BARE_CALL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(BROWSER_MESSAGE))).toBe(true);
  });

  it("rejects a bare quickAction( in workers/", { timeout: 60_000 }, async () => {
    const result = await lintTextAt("workers/workflow-monitor.ts", BARE_CALL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(BROWSER_MESSAGE))).toBe(true);
  });

  it("lets the bounded wrapper module call the binding", { timeout: 60_000 }, async () => {
    const messages = await lintExisting("app/lib/site/browser-budget.server.ts");
    expect(messages.some((m) => m.includes(BROWSER_MESSAGE))).toBe(false);
  });
});
