import { createExecutionContext, env } from "cloudflare:test";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MENTIONS_SWEEP_CRON, SITE_SWEEP_CRON, sweepMonitor } from "../../app/lib/cadence";
import type { MentionsSweep } from "../../workers/workflows/mentions";
import type { OwnSiteCheck } from "../../workers/workflows/own-site-check";
import type { SiteSweep } from "../../workers/workflows/site-sweep";

vi.mock("@sentry/cloudflare", () => ({
  captureCheckIn: vi.fn(() => "check-in-1"),
}));

let siteSweep: { prototype: SiteSweep };
let mentionsSweep: { prototype: MentionsSweep };
let ownSiteCheck: { prototype: OwnSiteCheck };
let checkInMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  vi.resetModules();
  const [site, mentions, ownSite, sentry] = await Promise.all([
    import("../../workers/workflows/site-sweep"),
    import("../../workers/workflows/mentions"),
    import("../../workers/workflows/own-site-check"),
    import("@sentry/cloudflare"),
  ]);
  siteSweep = site.SiteSweep;
  mentionsSweep = mentions.MentionsSweep;
  ownSiteCheck = ownSite.OwnSiteCheck;
  checkInMock = vi.mocked(sentry.captureCheckIn);
});

beforeEach(() => {
  checkInMock.mockClear();
});

const event = {
  timestamp: new Date(),
  instanceId: "monitor-test",
  payload: undefined,
} as unknown as WorkflowEvent<unknown>;

const immediateStep = {
  do: async (_label: string, configOrFn: unknown, maybeFn?: () => Promise<unknown>) => {
    const fn = typeof configOrFn === "function" ? configOrFn : maybeFn;
    if (typeof fn !== "function") throw new Error("no step callback");
    return fn();
  },
  sleep: async () => undefined,
} as unknown as WorkflowStep;

const makeWorkflow = <T extends object>(workflow: { prototype: T }): T => {
  const instance = Object.create(workflow.prototype) as T;
  Object.assign(instance, { env, ctx: createExecutionContext() });
  return instance;
};

const SITE_MONITOR = { ...sweepMonitor(SITE_SWEEP_CRON), timezone: "UTC" } as const;

const MENTIONS_MONITOR = { ...sweepMonitor(MENTIONS_SWEEP_CRON), timezone: "UTC" } as const;

const OWN_SITE_MONITOR = {
  schedule: { type: "crontab", value: "0 * * * *" },
  checkinMargin: 15,
  maxRuntime: 30,
  timezone: "UTC",
} as const;

describe("an instance started by a Workflow's own registered schedule", () => {
  const scheduled = {
    ...event,
    schedule: { cron: "0 2 * * *", scheduledTime: Date.UTC(2026, 9, 2, 2, 0, 0) },
  } as unknown as WorkflowEvent<unknown>;

  it("does no work and checks no monitor in, so the Worker cron is the only scheduler of the daily sweeps", async () => {
    expect(await makeWorkflow(siteSweep).run(scheduled, immediateStep)).toBeNull();
    expect(await makeWorkflow(mentionsSweep).run(scheduled, immediateStep)).toBeNull();
    expect(checkInMock).not.toHaveBeenCalled();
  });

  it("starts the own-site-check hour for itself and does no other work", async () => {
    const createBatch = vi.fn((batch: { id: string }[]) => Promise.resolve([...batch]));
    const workflow = makeWorkflow(ownSiteCheck);
    Object.assign(workflow, { env: { OWN_SITE_CHECK: { createBatch } } });
    const hourly = {
      ...event,
      timestamp: new Date(Date.UTC(2026, 9, 2, 6, 0, 9)),
      schedule: { cron: "0 * * * *", scheduledTime: Date.UTC(2026, 9, 2, 6, 0, 0) },
    } as unknown as WorkflowEvent<unknown>;
    expect(await workflow.run(hourly, immediateStep)).toBeNull();
    expect(createBatch).toHaveBeenCalledExactlyOnceWith([{ id: "own-site-check-2026-10-02T06" }]);
    expect(checkInMock).not.toHaveBeenCalled();
  });
});

describe("workflow Sentry cron monitors", () => {
  it("checks site-sweep in on its own registered monitor and returns the zeroed sweep", async () => {
    const outcome = await makeWorkflow(siteSweep).run(event, immediateStep);
    expect(checkInMock.mock.calls).toEqual([
      [{ monitorSlug: "site-sweep", status: "in_progress" }, SITE_MONITOR],
      [{ checkInId: "check-in-1", monitorSlug: "site-sweep", status: "ok" }, SITE_MONITOR],
    ]);
    expect(outcome).toEqual({
      pages: 0,
      failed: 0,
      gone: 0,
      first: 0,
      unchanged: 0,
      changed: 0,
      rechecked: 0,
      recorded: true,
    });
  });

  it("checks mentions-sweep in on its own registered monitor and returns the zeroed sweep", async () => {
    await env.DB.exec("UPDATE source SET canary_query = NULL");
    const outcome = await makeWorkflow(mentionsSweep).run(event, immediateStep);
    expect(checkInMock.mock.calls).toEqual([
      [{ monitorSlug: "mentions-sweep", status: "in_progress" }, MENTIONS_MONITOR],
      [{ checkInId: "check-in-1", monitorSlug: "mentions-sweep", status: "ok" }, MENTIONS_MONITOR],
    ]);
    expect(outcome).toEqual({ targets: 0, swept: 0, failed: 0, stored: 0, unjudged: 0, skipped: 0 });
  });

  it("checks own-site-check in on its hourly monitor and returns the zeroed check", async () => {
    const outcome = await makeWorkflow(ownSiteCheck).run(event, immediateStep);
    expect(checkInMock.mock.calls).toEqual([
      [{ monitorSlug: "own-site-check", status: "in_progress" }, OWN_SITE_MONITOR],
      [{ checkInId: "check-in-1", monitorSlug: "own-site-check", status: "ok" }, OWN_SITE_MONITOR],
    ]);
    expect(outcome).toEqual({ pages: 0, opened: 0, closed: 0, failed: 0 });
  });

  it("records an error check-in when a step fails and never sends ok", async () => {
    const failingStep = {
      do: async (label: string, configOrFn: unknown, maybeFn?: () => Promise<unknown>) => {
        if (label === "plan") throw new Error("plan down");
        const fn = typeof configOrFn === "function" ? configOrFn : maybeFn;
        if (typeof fn !== "function") throw new Error("no step callback");
        return fn();
      },
      sleep: async () => undefined,
    } as unknown as WorkflowStep;
    await expect(makeWorkflow(siteSweep).run(event, failingStep)).rejects.toThrow("plan down");
    expect(checkInMock.mock.calls).toEqual([
      [{ monitorSlug: "site-sweep", status: "in_progress" }, SITE_MONITOR],
      [{ checkInId: "check-in-1", monitorSlug: "site-sweep", status: "error" }, SITE_MONITOR],
    ]);
  });
});
