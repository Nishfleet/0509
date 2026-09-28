import { createExecutionContext, env } from "cloudflare:test";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { MentionsSweep } from "../../workers/workflows/mentions";
import type { OwnSiteCheck } from "../../workers/workflows/own-site-check";
import type { SiteSweep } from "../../workers/workflows/site-sweep";

vi.mock("@sentry/cloudflare", () => ({
  withMonitor: vi.fn((_slug: string, cb: () => unknown) => cb()),
}));

// The workflow modules are already in the module-runner registry (they belong
// to the main Worker's graph) before this file's mocks register, so a static
// import binds the real @sentry/cloudflare. Resetting the registry and
// re-importing inside beforeAll returns copies bound to the mock.
let siteSweep: { prototype: SiteSweep };
let mentionsSweep: { prototype: MentionsSweep };
let ownSiteCheck: { prototype: OwnSiteCheck };
let monitorMock: ReturnType<typeof vi.fn>;

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
  monitorMock = sentry.withMonitor as ReturnType<typeof vi.fn>;
});

beforeEach(() => {
  monitorMock.mockClear();
});

const event = {
  timestamp: new Date(),
  instanceId: "monitor-test",
  payload: undefined,
} as unknown as WorkflowEvent<unknown>;

const immediateStep = {
  do: async (_label: string, _config: unknown, fn: () => Promise<unknown>) => fn(),
  sleep: async () => undefined,
} as unknown as WorkflowStep;

// `new WorkflowEntrypoint(ctx, env)` requires workerd's own ExecutionContext,
// which exists only inside a real binding invocation; createExecutionContext()
// is a duck type and fails the native brand check. The methods under test need
// only the prototype and own `env`/`ctx` properties, so the instance is built
// by hand.
const makeWorkflow = <T extends object>(workflow: { prototype: T }): T => {
  const instance = Object.create(workflow.prototype) as T;
  Object.assign(instance, { env, ctx: createExecutionContext() });
  return instance;
};

describe("workflow Sentry cron monitors", () => {
  it("checks site-sweep in on its 02:00 UTC monitor and returns the zeroed sweep", async () => {
    const outcome = await makeWorkflow(siteSweep).run(event, immediateStep);
    expect(monitorMock).toHaveBeenCalledTimes(1);
    expect(monitorMock).toHaveBeenCalledWith("site-sweep", expect.any(Function), {
      schedule: { type: "crontab", value: "0 2 * * *" },
      checkinMargin: 60,
      timezone: "UTC",
    });
    expect(outcome).toEqual({
      pages: 0,
      failed: 0,
      first: 0,
      unchanged: 0,
      changed: 0,
      rechecked: 0,
    });
  });

  it("checks mentions-sweep in on its 01:00 UTC monitor and returns the zeroed sweep", async () => {
    // Migration 0018 seeds canary_query on the gdelt/hn sources; clearing it
    // keeps this run to plan + canary-plan only, with no upstream calls.
    await env.DB.exec("UPDATE source SET canary_query = NULL");
    const outcome = await makeWorkflow(mentionsSweep).run(event, immediateStep);
    expect(monitorMock).toHaveBeenCalledTimes(1);
    expect(monitorMock).toHaveBeenCalledWith("mentions-sweep", expect.any(Function), {
      schedule: { type: "crontab", value: "0 1 * * *" },
      checkinMargin: 60,
      timezone: "UTC",
    });
    expect(outcome).toEqual({ targets: 0, swept: 0, failed: 0, stored: 0, unjudged: 0 });
  });

  it("checks own-site-check in on its hourly monitor and returns the zeroed check", async () => {
    const outcome = await makeWorkflow(ownSiteCheck).run(event, immediateStep);
    expect(monitorMock).toHaveBeenCalledTimes(1);
    expect(monitorMock).toHaveBeenCalledWith("own-site-check", expect.any(Function), {
      schedule: { type: "crontab", value: "0 * * * *" },
      checkinMargin: 15,
      timezone: "UTC",
    });
    expect(outcome).toEqual({ pages: 0, opened: 0, closed: 0, failed: 0 });
  });

  it("propagates a step failure through the monitor so the check-in lands failed", async () => {
    const failingStep = {
      do: async (label: string, _config: unknown, fn: () => Promise<unknown>) => {
        if (label === "plan") throw new Error("plan down");
        return fn();
      },
      sleep: async () => undefined,
    } as unknown as WorkflowStep;
    await expect(makeWorkflow(siteSweep).run(event, failingStep)).rejects.toThrow("plan down");
    expect(monitorMock).toHaveBeenCalledTimes(1);
    expect(monitorMock).toHaveBeenCalledWith("site-sweep", expect.any(Function), expect.any(Object));
  });
});
