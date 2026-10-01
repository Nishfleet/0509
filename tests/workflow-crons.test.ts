import { describe, expect, it, vi } from "vitest";

import { isWorkflowCron, startScheduledWorkflow, WORKFLOW_CRONS } from "../workers/workflow-crons";

function fakeEnv() {
  const createBatch = vi.fn(() => Promise.resolve([]));
  const bindings = {
    MENTIONS: { createBatch },
    SITE_SWEEP: { createBatch },
    HIRING_SWEEP: { createBatch },
    SNAPSHOT_BACKUP: { createBatch },
  };
  return { createBatch, env: bindings as unknown as Parameters<typeof startScheduledWorkflow>[0] };
}

describe("startScheduledWorkflow", () => {
  it("creates the snapshot-backup instance under an id fixed by the scheduled instant", async () => {
    const { createBatch, env } = fakeEnv();
    const id = await startScheduledWorkflow(env, "0 5 * * *", Date.UTC(2026, 8, 30, 5, 0, 0));
    expect(id).toBe("snapshot-backup-2026-09-30T05-00-00-000Z");
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

  it("maps each daily cron to its own Workflow binding", () => {
    expect(Object.values(WORKFLOW_CRONS).map((entry) => entry.binding)).toEqual([
      "MENTIONS",
      "SITE_SWEEP",
      "HIRING_SWEEP",
      "SNAPSHOT_BACKUP",
    ]);
  });

  it("recognises only the workflow crons", () => {
    expect(isWorkflowCron("0 5 * * *")).toBe(true);
    expect(isWorkflowCron("0 3 * * *")).toBe(false);
    expect(isWorkflowCron("toString")).toBe(false);
  });
});
