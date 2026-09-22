import { afterEach, describe, expect, it, vi } from "vitest";

import { pingLiveness } from "../app/lib/liveness-ping.server";

const g = globalThis as { LIVENESS_PING_URL?: string };

afterEach(() => {
  delete g.LIVENESS_PING_URL;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("pingLiveness", () => {
  it("is silent when LIVENESS_PING_URL is unset", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(pingLiveness()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs with an abort signal that fires at the deadline", async () => {
    g.LIVENESS_PING_URL = "https://monitor.example/ping";
    let seen: RequestInit | undefined;
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
      seen = init;
      return new Promise(() => undefined);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const pending = pingLiveness();
    expect(pending).toBeInstanceOf(Promise);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith("https://monitor.example/ping", expect.any(Object));
    const signal = seen?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    const started = Date.now();
    await new Promise((resolve) => signal?.addEventListener("abort", resolve));
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(9_000);
    expect(elapsed).toBeLessThan(15_000);
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBeInstanceOf(DOMException);
    expect((signal?.reason as DOMException).name).toBe("TimeoutError");

    const settled = await Promise.race([
      pending?.then(() => "resolved"),
      Promise.resolve("still-pending"),
    ]);
    expect(settled).toBe("still-pending");
  }, 20_000);

  it("swallows a rejected fetch instead of surfacing it", async () => {
    g.LIVENESS_PING_URL = "https://monitor.example/ping";
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    await expect(pingLiveness()).resolves.toBeUndefined();
  });
});
