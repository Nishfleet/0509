import { describe, expect, it } from "vitest";
import { cspNonceForRender } from "~/root";

// Issue #2724 follow-up (2026-09-11): the deploy readiness gate went red with
// browser_hydration_error:console on every page. React 19 diffed the client's
// nonce prop against the DOM, where a parsed nonce reads back as "", and
// reported an attribute mismatch on <script nonce>, <link nonce> (React
// Router's <Links>) and the font-swap script. The layout now stamps the nonce
// on the server render only; the client render carries the same "" the DOM
// does. This pins the rule so the mismatch cannot come back silently.
describe("cspNonceForRender", () => {
  it("stamps the per-request nonce on the server render", () => {
    expect(cspNonceForRender("abc123", true)).toBe("abc123");
  });

  it("renders an empty nonce on the client so hydration matches the hidden DOM attribute", () => {
    expect(cspNonceForRender("abc123", false)).toBe("");
  });

  it("stays undefined on the server when the worker set no nonce (no attribute emitted)", () => {
    expect(cspNonceForRender(undefined, true)).toBeUndefined();
  });
});
