import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ key: "k".repeat(12) as string | undefined }));

vi.mock("cloudflare:workers", () => ({
  env: {
    get HEALTHCHECKS_PING_KEY() {
      return state.key;
    },
  },
}));

vi.mock("../app/lib/fetch/outbound.server", () => ({ fetchOutbound: vi.fn() }));

import { fetchOutbound } from "../app/lib/fetch/outbound.server";
import { pingCheck } from "../app/lib/healthcheck.server";

const send = vi.mocked(fetchOutbound);

function lines(spy: { mock: { calls: unknown[][] } }): unknown[] {
  return spy.mock.calls.map((call): unknown => JSON.parse(String(call[0])));
}

describe("pingCheck", () => {
  beforeEach(() => {
    send.mockReset();
    state.key = "k".repeat(12);
  });

  it("logs healthcheck.ping_ok with the slug and the HTTP status, so a ping is provable from the logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    send.mockResolvedValue(new Response("OK", { status: 200 }));
    await pingCheck("nightly", "ok");
    expect(lines(warn)).toEqual([{ event: "healthcheck.ping_ok", check: "nightly", signal: "ok", status: 200 }]);
    warn.mockRestore();
  });

  it("logs the body it sent, so the counts and ids of a degraded run are provable from the logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    send.mockResolvedValue(new Response("OK", { status: 200 }));
    await pingCheck("site-sweep", "fail", "degraded: 13 of 140 failed: page-a");
    expect(lines(warn)).toEqual([
      {
        event: "healthcheck.ping_ok",
        check: "site-sweep",
        signal: "fail",
        status: 200,
        body: "degraded: 13 of 140 failed: page-a",
      },
    ]);
    warn.mockRestore();
  });

  it("logs healthcheck.ping_failed with the status when healthchecks.io refuses the ping", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    send.mockResolvedValue(new Response("no", { status: 404 }));
    await pingCheck("nightly", "ok");
    expect(lines(warn)).toEqual([{ event: "healthcheck.ping_failed", check: "nightly", signal: "ok", status: 404 }]);
    warn.mockRestore();
  });

  it("logs healthcheck.ping_failed when the request throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    send.mockRejectedValue(new TypeError("network"));
    await pingCheck("site-sweep", "fail");
    expect(lines(warn)).toEqual([
      { event: "healthcheck.ping_failed", check: "site-sweep", signal: "fail", kind: "TypeError" },
    ]);
    warn.mockRestore();
  });

  it("logs healthcheck.ping_skipped and sends nothing when no ping key is set", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    state.key = undefined;
    await pingCheck("nightly", "ok");
    expect(send).not.toHaveBeenCalled();
    expect(lines(warn)).toEqual([{ event: "healthcheck.ping_skipped", check: "nightly", signal: "ok" }]);
    warn.mockRestore();
  });
});
