import { captureException, captureMessage } from "@sentry/cloudflare";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MENTIONS_SWEEP_CRON, OWN_SITE_CHECK_CRON } from "../app/lib/cadence";
import {
  isNativeSchedule,
  isWorkflowCron,
  reportMissedWorkflows,
  startMissedDailyWorkflows,
  startMissedOwnSiteCheck,
  startMissedWorkflows,
  startOwnSiteCheckHour,
  startScheduledWorkflow,
  WORKFLOW_CRONS,
} from "../workers/workflow-crons";

vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

function fakeEnv(existing = new Set<string>()) {
  const createBatch = vi.fn((batch: { id: string }[]) =>
    Promise.resolve(existing.has(batch[0]?.id ?? "") ? [] : [...batch]),
  );
  const bindings = {
    MENTIONS: { createBatch },
    SITE_SWEEP: { createBatch },
    HIRING_SWEEP: { createBatch },
    FEED_SWEEP: { createBatch },
    SNAPSHOT_BACKUP: { createBatch },
    OWN_SITE_CHECK: { createBatch },
  };
  return { createBatch, env: bindings as unknown as Parameters<typeof startScheduledWorkflow>[0] };
}

describe("startScheduledWorkflow", () => {
  it("creates the snapshot-backup instance under an id fixed by the day", async () => {
    const { createBatch, env } = fakeEnv();
    const id = await startScheduledWorkflow(env, "0 5 * * *", Date.UTC(2026, 8, 30, 5, 0, 0));
    expect(id).toBe("snapshot-backup-2026-09-30");
    expect(createBatch).toHaveBeenCalledExactlyOnceWith([{ id }]);
  });

  it("builds an id Workflows accepts: letters, digits, dash and underscore only", async () => {
    const { env } = fakeEnv();
    const id = await startScheduledWorkflow(env, "0 1 * * *", Date.UTC(2026, 9, 1, 1, 0, 0));
    expect(id).toMatch(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/);
  });

  it("gives a double fire of the same instant the same id, so createBatch skips the second", async () => {
    const { env } = fakeEnv();
    const at = Date.UTC(2026, 8, 30, 1, 0, 0);
    expect(await startScheduledWorkflow(env, "0 1 * * *", at)).toBe(await startScheduledWorkflow(env, "0 1 * * *", at));
  });

  it("maps each cron to its own Workflow binding", () => {
    expect(Object.values(WORKFLOW_CRONS).map((entry) => entry.binding)).toEqual([
      "MENTIONS",
      "SITE_SWEEP",
      "HIRING_SWEEP",
      "FEED_SWEEP",
      "SNAPSHOT_BACKUP",
      "OWN_SITE_CHECK",
    ]);
  });

  it("starts the own-site-check instance under an id fixed by the hour", async () => {
    const { createBatch, env } = fakeEnv();
    const id = await startScheduledWorkflow(env, "0 * * * *", Date.UTC(2026, 9, 1, 13, 0, 0));
    expect(id).toBe("own-site-check-2026-10-01T13");
    expect(createBatch).toHaveBeenCalledExactlyOnceWith([{ id }]);
  });

  it("starts a daily job a missed tick left out, and none that is not due yet", async () => {
    const { createBatch, env } = fakeEnv();
    const results = await startMissedDailyWorkflows(env, Date.UTC(2026, 9, 2, 2, 10, 0));
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(createBatch.mock.calls.flat().flat()).toEqual([
      { id: "mentions-sweep-2026-10-02" },
      { id: "site-sweep-2026-10-02" },
    ]);
  });

  it("leaves a daily slot that equals the current tick to its own cron trigger, so the catch-up never starts it first", async () => {
    const { createBatch, env } = fakeEnv();
    await startMissedDailyWorkflows(env, Date.UTC(2026, 9, 2, 1, 0, 0));
    expect(createBatch).not.toHaveBeenCalled();
  });

  it("tags each catch-up result with its cron, so a warning can carry a fingerprint fixed by the cron", async () => {
    const { env } = fakeEnv(new Set(["own-site-check-2026-10-02T06"]));
    const results = await startMissedWorkflows(env, Date.UTC(2026, 9, 2, 7, 0, 0));
    const ownSite = results
      .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
      .find((value) => value.cron === OWN_SITE_CHECK_CRON);
    expect(ownSite).toEqual({ cron: OWN_SITE_CHECK_CRON, id: "own-site-check-2026-10-02T06", created: false });
  });

  it("gives the catch-up the same id as the cron tick, so a normal day starts each job once", async () => {
    const { createBatch, env } = fakeEnv();
    const tick = await startScheduledWorkflow(env, "0 1 * * *", Date.UTC(2026, 9, 2, 1, 0, 23));
    const catchUp = Date.UTC(2026, 9, 2, 6, 0, 0);
    await startMissedDailyWorkflows(env, catchUp);
    const ids = createBatch.mock.calls.flat().flat();
    expect(ids.filter((entry) => entry.id.startsWith("mentions-sweep"))).toEqual([{ id: tick }, { id: tick }]);
  });

  it("reports only the instances the catch-up really created, and leaves a failed or running one alone", async () => {
    const { env } = fakeEnv(new Set(["mentions-sweep-2026-10-02"]));
    const results = await startMissedDailyWorkflows(env, Date.UTC(2026, 9, 2, 3, 0, 0));
    expect(results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))).toEqual([
      { cron: "0 1 * * *", id: "mentions-sweep-2026-10-02", created: false },
      { cron: "0 2 * * *", id: "site-sweep-2026-10-02", created: true },
      { cron: "30 2 * * *", id: "hiring-sweep-2026-10-02", created: true },
      { cron: "45 2 * * *", id: "feed-sweep-2026-10-02", created: true },
    ]);
  });

  it("gives the cron tick and the Workflow's own schedule one id per hour, so the second start is a no-op", async () => {
    const { createBatch, env } = fakeEnv(new Set(["own-site-check-2026-10-02T06"]));
    const fromCron = await startScheduledWorkflow(env, "0 * * * *", Date.UTC(2026, 9, 2, 6, 0, 23));
    const fromNative = await startOwnSiteCheckHour(env, Date.UTC(2026, 9, 2, 6, 0, 9));
    expect(fromCron).toBe("own-site-check-2026-10-02T06");
    expect(fromNative).toEqual({ id: "own-site-check-2026-10-02T06", created: false });
    expect(createBatch).toHaveBeenCalledTimes(2);
  });

  it("still starts the hour from the Workflow's own schedule when the cron tick never ran", async () => {
    const { env } = fakeEnv();
    expect(await startOwnSiteCheckHour(env, Date.UTC(2026, 9, 2, 6, 0, 9))).toEqual({
      id: "own-site-check-2026-10-02T06",
      created: true,
    });
  });

  it("starts the previous hour when its instance is missing, and leaves one that exists alone", async () => {
    const missing = fakeEnv(new Set(["own-site-check-2026-10-02T05"]));
    expect(await startMissedOwnSiteCheck(missing.env, Date.UTC(2026, 9, 2, 7, 0, 12))).toEqual({
      id: "own-site-check-2026-10-02T06",
      created: true,
    });
    const present = fakeEnv(new Set(["own-site-check-2026-10-02T06"]));
    expect(await startMissedOwnSiteCheck(present.env, Date.UTC(2026, 9, 2, 7, 0, 12))).toEqual({
      id: "own-site-check-2026-10-02T06",
      created: false,
    });
  });

  it("recognises only the workflow crons", () => {
    expect(isWorkflowCron("0 5 * * *")).toBe(true);
    expect(isWorkflowCron("0 * * * *")).toBe(true);
    expect(isWorkflowCron("*/5 * * * *")).toBe(false);
    expect(isWorkflowCron("0 3 * * *")).toBe(false);
    expect(isWorkflowCron("toString")).toBe(false);
  });
});

describe("reportMissedWorkflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a real catch-up under a message and fingerprint fixed by the cron, with the instance id in extra", () => {
    reportMissedWorkflows([
      { status: "fulfilled", value: { cron: MENTIONS_SWEEP_CRON, id: "mentions-sweep-2026-10-02", created: true } },
    ]);
    expect(captureMessage).toHaveBeenCalledExactlyOnceWith("Missed Workflow started: mentions-sweep", {
      level: "warning",
      fingerprint: ["missed-workflow", MENTIONS_SWEEP_CRON],
      extra: { id: "mentions-sweep-2026-10-02" },
    });
  });

  it("never puts the instance id or its date into the message, so a daily miss stays one Sentry group", () => {
    reportMissedWorkflows([
      { status: "fulfilled", value: { cron: MENTIONS_SWEEP_CRON, id: "mentions-sweep-2026-10-02", created: true } },
      { status: "fulfilled", value: { cron: MENTIONS_SWEEP_CRON, id: "mentions-sweep-2026-10-03", created: true } },
    ]);
    expect(new Set(vi.mocked(captureMessage).mock.calls.map((call) => call[0])).size).toBe(1);
  });

  it("leaves a start the catch-up did not perform alone", () => {
    reportMissedWorkflows([
      { status: "fulfilled", value: { cron: MENTIONS_SWEEP_CRON, id: "mentions-sweep-2026-10-02", created: false } },
    ]);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("captures a failed start as an exception", () => {
    const reason = new Error("D1 unavailable");
    reportMissedWorkflows([{ status: "rejected", reason }]);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(reason);
    expect(captureMessage).not.toHaveBeenCalled();
  });
});

describe("isNativeSchedule", () => {
  it("is true for a cron tick the runtime delivers", () => {
    expect(isNativeSchedule({ schedule: "0 5 * * *" })).toBe(true);
  });

  it("is true for a Workflow's own schedule, which carries no cron string", () => {
    expect(isNativeSchedule({ schedule: null })).toBe(true);
  });

  it("is false for a manual start, which has no schedule field", () => {
    expect(isNativeSchedule({})).toBe(false);
  });

  it("is false when the schedule field is there but undefined", () => {
    expect(isNativeSchedule({ schedule: undefined })).toBe(false);
  });
});
