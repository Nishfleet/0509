import type { WorkflowStep } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/cloudflare", () => ({
  captureCheckIn: vi.fn(() => "check-in-1"),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("../app/lib/healthcheck.server", () => ({
  pingCheck: vi.fn(() => Promise.resolve(null)),
}));

import { captureCheckIn, captureException, captureMessage } from "@sentry/cloudflare";
import { pingCheck } from "../app/lib/healthcheck.server";
import type { RunHealth } from "../app/lib/sweep-health";
import { withCheckPings, withStepCheckIn } from "../workers/workflow-monitor";

const checkIn = vi.mocked(captureCheckIn);
const exception = vi.mocked(captureException);
const warning = vi.mocked(captureMessage);
const ping = vi.mocked(pingCheck);

const MONITOR = {
  slug: "feed-sweep",
  config: {
    schedule: { type: "crontab" as const, value: "45 2 * * *" },
    checkinMargin: 60,
    maxRuntime: 90,
    timezone: "UTC" as const,
  },
};

function memoStep(): WorkflowStep {
  const results = new Map<string, unknown>();
  return {
    do: async (label: string, configOrFn: unknown, maybeFn?: () => Promise<unknown>) => {
      if (results.has(label)) return results.get(label);
      const fn = typeof configOrFn === "function" ? configOrFn : maybeFn;
      if (typeof fn !== "function") throw new Error(`no callback for ${label}`);
      const value = await fn();
      results.set(label, value);
      return value;
    },
    sleep: async () => undefined,
  } as unknown as WorkflowStep;
}

describe("withStepCheckIn", () => {
  beforeEach(() => {
    checkIn.mockClear();
    ping.mockClear();
    exception.mockClear();
  });

  it("pings the sweep's healthcheck once, when the sweep ends ok", async () => {
    await withStepCheckIn(memoStep(), MONITOR, async () => ({ failed: 0 }));
    expect(ping.mock.calls).toEqual([["feed-sweep", "ok", undefined]]);
  });

  it("pings fail, never ok, when the sweep throws", async () => {
    await expect(
      withStepCheckIn(memoStep(), MONITOR, async () => {
        throw new Error("plan down");
      }),
    ).rejects.toThrow("plan down");
    expect(ping.mock.calls).toEqual([["feed-sweep", "fail", "failed: threw"]]);
  });

  it("sends no ping before the sweep ends, even when run() replays after hibernation", async () => {
    const step = memoStep();
    void withStepCheckIn(step, MONITOR, () => new Promise(() => undefined));
    await vi.waitFor(() => {
      expect(checkIn).toHaveBeenCalledTimes(1);
    });
    expect(ping).not.toHaveBeenCalled();
    await withStepCheckIn(step, MONITOR, async () => ({ failed: 0 }));
    expect(ping.mock.calls).toEqual([["feed-sweep", "ok", undefined]]);
  });

  it("opens in_progress inside monitor start and closes ok inside monitor ok", async () => {
    const outcome = await withStepCheckIn(memoStep(), MONITOR, async () => ({ failed: 0 }));
    expect(outcome).toEqual({ failed: 0 });
    expect(checkIn.mock.calls).toEqual([
      [{ monitorSlug: "feed-sweep", status: "in_progress" }, MONITOR.config],
      [{ checkInId: "check-in-1", monitorSlug: "feed-sweep", status: "ok" }, MONITOR.config],
    ]);
  });

  it("does not open a second in_progress when run() replays after hibernation", async () => {
    const step = memoStep();
    void withStepCheckIn(step, MONITOR, () => new Promise(() => undefined));
    await vi.waitFor(() => {
      expect(checkIn).toHaveBeenCalledTimes(1);
    });
    expect(checkIn).toHaveBeenCalledWith({ monitorSlug: "feed-sweep", status: "in_progress" }, MONITOR.config);

    checkIn.mockClear();
    const outcome = await withStepCheckIn(step, MONITOR, async () => ({ failed: 0 }));
    expect(outcome).toEqual({ failed: 0 });
    expect(checkIn.mock.calls).toEqual([
      [{ checkInId: "check-in-1", monitorSlug: "feed-sweep", status: "ok" }, MONITOR.config],
    ]);
  });

  it("records error from the failed step and does not send ok", async () => {
    await expect(
      withStepCheckIn(memoStep(), MONITOR, async () => {
        throw new Error("plan down");
      }),
    ).rejects.toThrow("plan down");
    expect(checkIn.mock.calls.map((call) => call[0])).toEqual([
      { monitorSlug: "feed-sweep", status: "in_progress" },
      { checkInId: "check-in-1", monitorSlug: "feed-sweep", status: "error" },
    ]);
  });
});

describe("withStepCheckIn on a run that finished but did not work", () => {
  beforeEach(() => {
    checkIn.mockClear();
    ping.mockClear();
    exception.mockClear();
    warning.mockClear();
  });

  const run = (health: RunHealth) =>
    withStepCheckIn(memoStep(), { ...MONITOR, health: () => health }, async () => ({ failed: 3 }));

  it("closes the check-in as error, pings fail and tells Sentry, and still returns the outcome", async () => {
    expect(await run({ state: "failed", reason: "30 of 40 failed" })).toEqual({ failed: 3 });
    expect(ping.mock.calls).toEqual([["feed-sweep", "fail", "failed: 30 of 40 failed"]]);
    expect(checkIn.mock.calls.map((call) => call[0])).toEqual([
      { monitorSlug: "feed-sweep", status: "in_progress" },
      { checkInId: "check-in-1", monitorSlug: "feed-sweep", status: "error" },
    ]);
    expect(exception).toHaveBeenCalledTimes(1);
  });

  it("keeps the Sentry check-in green with a warning but pings the health check as down with the counts when degraded", async () => {
    await run({ state: "degraded", reason: "2 of 40 failed: page-a, page-b" });
    expect(ping.mock.calls).toEqual([["feed-sweep", "fail", "degraded: 2 of 40 failed: page-a, page-b"]]);
    expect(checkIn.mock.calls[1]?.[0]).toMatchObject({ status: "ok" });
    expect(warning).toHaveBeenCalledWith(
      "feed-sweep degraded: 2 of 40 failed: page-a, page-b",
      expect.objectContaining({ level: "warning" }),
    );
    expect(exception).not.toHaveBeenCalled();
  });

  it("closes ok and tells Sentry nothing when the run is healthy", async () => {
    await run({ state: "ok" });
    expect(ping.mock.calls).toEqual([["feed-sweep", "ok", undefined]]);
    expect(exception).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });
});

describe("withCheckPings", () => {
  beforeEach(() => {
    ping.mockClear();
  });

  it("pings ok after a daily cron", async () => {
    const work = vi.fn(() => Promise.resolve());
    await withCheckPings("nightly", true, work);
    expect(ping.mock.calls).toEqual([["nightly", "ok"]]);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("pings fail and rethrows when the cron throws", async () => {
    await expect(withCheckPings("nightly", true, () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(ping.mock.calls).toEqual([["nightly", "fail"]]);
  });

  it("only runs the work for a cron that has no daily check", async () => {
    const work = vi.fn(() => Promise.resolve());
    await withCheckPings("weekly-refresh", false, work);
    expect(work).toHaveBeenCalledTimes(1);
    expect(ping).not.toHaveBeenCalled();
  });
});
