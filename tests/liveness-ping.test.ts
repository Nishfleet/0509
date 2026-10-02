import { afterEach, describe, expect, it, vi } from "vitest";

import { pingLiveness } from "../app/lib/liveness-ping.server";

const PING_URL = "https://monitor.example.com/ping";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pingLiveness", () => {
  it("is silent when LIVENESS_PING_URL is unset", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(pingLiveness(undefined)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs with an abort signal set to the 10 s deadline", async () => {
    const seen: (RequestInit | undefined)[] = [];
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
      seen.push(init);
      return new Promise(() => undefined);
    });
    vi.stubGlobal("fetch", fetchSpy);

    // A plain spy calls through, so the module's AbortSignal.timeout(10_000)
    // really runs and hands fetch a live signal.
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    const pending = pingLiveness(PING_URL);
    expect(pending).toBeInstanceOf(Promise);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(PING_URL, expect.any(Object));
    expect(timeoutSpy).toHaveBeenCalledOnce();
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    const signal = seen[0]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal).toBe(timeoutSpy.mock.results[0].value);
    expect(signal?.aborted).toBe(false);

    // The abort reason is proven without waiting on the clock: the spy now
    // returns an already-aborted signal carrying the timeout's own reason.
    timeoutSpy.mockReturnValue(AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
    const pendingAgain = pingLiveness(PING_URL);
    expect(pendingAgain).toBeInstanceOf(Promise);
    expect(timeoutSpy).toHaveBeenCalledTimes(2);
    const abortedSignal = seen[1]?.signal;
    expect(abortedSignal).toBe(timeoutSpy.mock.results[1].value);
    expect(abortedSignal?.aborted).toBe(true);
    expect(abortedSignal?.reason).toBeInstanceOf(DOMException);
    expect((abortedSignal?.reason as DOMException).name).toBe("TimeoutError");

    // fetch never settles, so the returned promises stay pending.
    const settled = await Promise.race([
      pending?.then(() => "resolved"),
      pendingAgain?.then(() => "resolved"),
      Promise.resolve("still-pending"),
    ]);
    expect(settled).toBe("still-pending");
  });

  it("swallows a rejected fetch instead of surfacing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    await expect(pingLiveness(PING_URL)).resolves.toBeUndefined();
  });
});
