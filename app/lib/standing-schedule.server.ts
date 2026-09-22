import {
  currentWeekStart,
  instanceId,
  nextRolloverInstant,
  weekClosedBy,
  type WorkspaceClock,
} from "./standing-score";

export interface RolloverParams {
  workspaceId: string;
  runAt: string;
  closeWeekStart: string;
}

interface RolloverHandle {
  id: string;
  status(): Promise<{ status: string }>;
  terminate(): Promise<void>;
}

export interface RolloverBinding {
  get(id: string): Promise<RolloverHandle>;
  create(options: { id: string; params: RolloverParams }): Promise<RolloverHandle>;
}

export interface ScheduleDb {
  prepare(sql: string): {
    bind(...values: (string | number | null)[]): {
      run(): Promise<unknown>;
      first<T>(): Promise<T | null>;
    };
  };
}

const OPEN = new Set(["queued", "running", "paused", "waiting", "waitingForPause"]);

export async function replaceRollover(
  binding: RolloverBinding,
  db: ScheduleDb,
  workspace: WorkspaceClock,
  previousInstanceId: string | null,
  now: Date,
): Promise<string> {
  const runAt = nextRolloverInstant(now, workspace.timezone, workspace.briefWeekday, workspace.briefHour);
  const closeWeekStart = weekClosedBy(runAt, workspace.timezone);
  return createRollover(binding, db, workspace.id, previousInstanceId, {
    workspaceId: workspace.id,
    runAt,
    closeWeekStart,
  });
}

export async function spawnNext(
  binding: RolloverBinding,
  db: ScheduleDb,
  workspace: WorkspaceClock,
  firedAt: string,
): Promise<string> {
  const runAt = nextRolloverInstant(
    new Date(Date.parse(firedAt)),
    workspace.timezone,
    workspace.briefWeekday,
    workspace.briefHour,
  );
  return createRollover(binding, db, workspace.id, null, {
    workspaceId: workspace.id,
    runAt,
    closeWeekStart: weekClosedBy(runAt, workspace.timezone),
  });
}

export async function createCatchUp(
  binding: RolloverBinding,
  db: ScheduleDb,
  workspace: WorkspaceClock,
  previousInstanceId: string | null,
  now: Date,
): Promise<string | null> {
  if (previousInstanceId && (await stillOpen(binding, previousInstanceId))) return null;
  const runAt = now.toISOString();
  const closeWeekStart = weekClosedBy(
    currentWeekStart(now, workspace.timezone, workspace.briefWeekday, workspace.briefHour),
    workspace.timezone,
  );
  return createRollover(binding, db, workspace.id, previousInstanceId, {
    workspaceId: workspace.id,
    runAt,
    closeWeekStart,
  });
}

async function stillOpen(binding: RolloverBinding, id: string): Promise<boolean> {
  try {
    const handle = await binding.get(id);
    const status = await handle.status();
    return OPEN.has(status.status);
  } catch {
    return false;
  }
}

async function createRollover(
  binding: RolloverBinding,
  db: ScheduleDb,
  workspaceId: string,
  previousInstanceId: string | null,
  params: RolloverParams,
): Promise<string> {
  const id = instanceId(workspaceId, params.runAt);
  if (previousInstanceId && previousInstanceId !== id) {
    try {
      const previous = await binding.get(previousInstanceId);
      await previous.terminate();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
  }
  return createInstance(binding, db, workspaceId, params, id);
}

async function createInstance(
  binding: RolloverBinding,
  db: ScheduleDb,
  workspaceId: string,
  params: RolloverParams,
  id: string,
): Promise<string> {
  const created = await binding.create({ id, params });
  await db
    .prepare("UPDATE workspace SET next_brief_at = ?, standing_instance_id = ? WHERE id = ?")
    .bind(params.runAt, created.id, workspaceId)
    .run();
  return created.id;
}
