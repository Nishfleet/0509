import type { WorkflowStep } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/cloudflare", () => ({
  captureCheckIn: vi.fn(() => "check-in-1"),
}));

import { captureCheckIn } from "@sentry/cloudflare";
import { withStepCheckIn } from "../workers/workflow-monitor";

const checkIn = vi.mocked(captureCheckIn);

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
