import { afterEach, describe, expect, it, vi } from "vitest";

import { pingLiveness } from "../app/lib/liveness-ping.server";

const PING_URL = "https://monitor.example/ping";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pingLiveness", () => {
  it("is silent when LIVENESS_PING_URL is unset", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(pingLiveness(undefined)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs with an abort signal that fires at the deadline", async () => {
    let seen: RequestInit | undefined;
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
      seen = init;
      return new Promise(() => undefined);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const pending = pingLiveness(PING_URL);
    expect(pending).toBeInstanceOf(Promise);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(PING_URL, expect.any(Object));
    const signal = seen?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    const started = Date.now();
    await new Promise((resolve) => signal?.addEventListener("abort", resolve));
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(9_000);
    expect(elapsed).toBeLessThan(20_000);
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBeInstanceOf(DOMException);
    expect((signal?.reason as DOMException).name).toBe("TimeoutError");

    const settled = await Promise.race([
      pending?.then(() => "resolved"),
      Promise.resolve("still-pending"),
    ]);
    expect(settled).toBe("still-pending");
  }, 30_000);

  it("swallows a rejected fetch instead of surfacing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    await expect(pingLiveness(PING_URL)).resolves.toBeUndefined();
  });
});
