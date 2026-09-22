import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../../workers/app";

/**
 * The outer loop's trigger, proven against the real Worker entry in workerd.
 *
 * `workers/app.ts` wraps the default export in `Sentry.withSentry`, and the
 * wrapper replaces `scheduled` with its own proxy. The call goes through that
 * proxy inside this isolate: `exports.default` is an RPC boundary, and a
 * `ScheduledController` cannot be serialized across it. The React Router
 * server build is not bundled here either, so `fetch` is not what this
 * asserts. No DSN is configured, so nothing is reported.
 */
describe("sentry wrap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("runs the scheduled handler through the wrapped export", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("LIVENESS_PING_URL", "https://liveness.example.test/ping");

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "*/5 * * * *" }), {}, ctx);
    await waitOnExecutionContext(ctx);

    expect(fetchMock).toHaveBeenCalledWith("https://liveness.example.test/ping", { method: "POST" });
  });
});
