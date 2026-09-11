import { describe, expect, it, vi } from "vitest";

/**
 * Issue #2724 — the nonce-based CSP must cover React Router's streamed handoff
 * chunks, not just the scripts app/root.tsx renders.
 *
 * `tests/worker-csp-nonce.test.ts` proves the worker generates one nonce and
 * puts the same value in the header and in the cloudflare context, and
 * `app/root.tsx` stamps `<Scripts nonce>`/`<ScrollRestoration nonce>`/the boot
 * scripts. None of that reaches `ServerRouter`, which is what emits
 * `window.__reactRouterContext.streamController.enqueue(...)` and
 * `...close();` from the streaming render inside app/entry.server.tsx.
 *
 * When those two chunks shipped without a nonce the browser blocked them under
 * `script-src 'nonce-…'`: the client router never received its loader data, the
 * document rendered but never hydrated, and every assertion that needed a click
 * or a status announcement failed while every server-rendered assertion passed.
 * Caught in production by 27 unrelated-looking e2e failures, never by a named
 * test — so pin the seam that actually broke.
 *
 * `ServerRouter` is stubbed to capture its props: the property under test is
 * the entry-server wiring (does the context nonce reach the component that
 * emits the inline chunks), not React Router's own rendering.
 */

const captured: { nonce?: string; url?: string } = {};

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    ServerRouter: (props: { nonce?: string; url?: string }) => {
      captured.nonce = props.nonce;
      captured.url = props.url;
      return null;
    },
  };
});

const { cloudflareRuntimeContext } = await import("../app/lib/cloudflare-context");
const { default: handleRequest } = await import("../app/entry.server");

function renderWith(contextNonce: string | undefined) {
  const stored = new Map<unknown, unknown>();
  if (contextNonce !== undefined) {
    stored.set(cloudflareRuntimeContext, {
      env: {},
      ctx: {},
      country: null,
      cspNonce: contextNonce,
    });
  }
  const loadContext = {
    get: (key: unknown) => stored.get(key),
    set: (key: unknown, value: unknown) => stored.set(key, value),
  };
  return handleRequest(
    new Request("https://five-to-nine.test/", { headers: { accept: "text/html" } }),
    200,
    new Headers(),
    // The streaming render only needs these two fields to take the non-bot path.
    { isSpaMode: false } as never,
    loadContext as never,
  );
}

describe("entry.server CSP nonce handoff", () => {
  it("passes the worker's per-request nonce to ServerRouter", async () => {
    captured.nonce = undefined;
    const response = await renderWith("test-nonce-abc123");
    expect(response.status).toBe(200);
    expect(captured.nonce).toBe("test-nonce-abc123");
  });

  it("leaves the nonce absent, never an empty attribute, without one", async () => {
    captured.nonce = "stale";
    await renderWith(undefined);
    // `nonce=""` is an invalid attribute React would still render; an absent
    // value drops it. Only a real nonce may ever reach the inline chunks.
    expect(captured.nonce).toBeUndefined();
  });
});
