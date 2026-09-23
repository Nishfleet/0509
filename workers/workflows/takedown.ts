import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

export interface TakedownParams {
  takedownId: string;
}

interface TakedownRow {
  id: string;
  subject_kind: string;
  reason: string;
  requested_at: string;
  actioned_at: string;
  actioned_by: string;
  subject_value: string;
  fanned_out_at: string | null;
  note: string | null;
}

type TakedownEnv = Pick<Env, "DB" | "CARD_ARTIFACTS">;
type ReconcileEnv = Pick<Env, "DB" | "TAKEDOWN_WORKFLOW">;

export type { ReconcileEnv };

interface AffectedWorkspace {
  workspaceId: string;
  entityId: string;
  entityRole: "self" | "competitor";
  r2Keys: string[];
}

interface WorkspaceOutcome {
  workspaceId: string;
  role: "self" | "competitor";
  dismissed: boolean;
  signalsDeleted: number;
  objectsDeleted: number;
  alertId: string;
}

export interface FanOutSummary {
  takedownId: string;
  subjectValue: string;
  completedAt: string | null;
  workspaces: WorkspaceOutcome[];
  selfWorkspaces: number;
}

const ALERT_TITLE = "Removed a tracked subject at request";
const R2_DELETE_BATCH = 1_000;

const SELECT_TAKEDOWN = `SELECT id, subject_kind, subject_value, reason, requested_at, actioned_at, actioned_by, fanned_out_at, note
FROM takedown WHERE id = ? AND fanned_out_at IS NULL`;

const SELECT_AFFECTED = `SELECT e.workspace_id AS workspace_id,
       e.id AS entity_id,
       e.role AS entity_role,
       COALESCE((
         SELECT group_concat(DISTINCT s.payload_r2_key)
           FROM snapshot s
           JOIN watch w ON w.id = s.watch_id
          WHERE w.entity_id = e.id
            AND s.payload_r2_key IS NOT NULL
       ), '') AS r2_keys
  FROM entity e
 WHERE lower(e.domain) = ?
 ORDER BY e.workspace_id ASC`;

const DISMISS_ENTITY = `UPDATE entity
SET state = 'dismissed', state_reason = 'takedown', state_changed_by = 'auto', state_changed_at = ?
WHERE id = ? AND role = 'competitor' AND state <> 'dismissed'`;

const DELETE_SIGNALS = `DELETE FROM signal WHERE entity_id = ? AND workspace_id = ?`;

const INSERT_ALERT = `INSERT INTO alert (id, workspace_id, entity_id, kind, severity, title, body, status, created_at)
VALUES (?, ?, ?, 'takedown', 'high', ?, ?, 'unread', ?)
ON CONFLICT(id) DO NOTHING`;

const SET_FANNED_OUT = `UPDATE takedown SET fanned_out_at = ?, note = ? WHERE id = ? AND fanned_out_at IS NULL`;

const PARK_UNRESOLVED = `UPDATE takedown SET note = ? WHERE id = ? AND fanned_out_at IS NULL`;

const SUBJECT_KIND_DOMAIN = "domain";
const SUBJECT_KIND_HANDLE = "handle";

export const SUBJECT_UNRESOLVED = "subject unresolved";

function isResolvable(granted: TakedownRow): boolean {
  const value = granted.subject_value.trim().toLowerCase();
  if (value.length === 0) return false;
  if (granted.subject_kind === SUBJECT_KIND_HANDLE) return false;
  if (granted.subject_kind !== SUBJECT_KIND_DOMAIN) return false;
  if (value.includes("/") || value.includes(" ") || value.includes("@")) return false;
  return value.includes(".");
}

function unresolvableNote(granted: TakedownRow): string {
  if (granted.subject_kind === SUBJECT_KIND_HANDLE) {
    return `${SUBJECT_UNRESOLVED}: a handle has no join key against entity.domain until P1.1 lands a handle -> registrable normaliser (#3885); fanned_out_at stays NULL so the row is not recorded as removed`;
  }
  return `${SUBJECT_UNRESOLVED}: subject_value is not a bare registrable, so it cannot match entity.domain; fanned_out_at stays NULL so the row is not recorded as removed`;
}

function parseKeys(raw: string): string[] {
  if (raw.length === 0) return [];
  return raw.split(",").filter((key) => key.length > 0);
}

function ownerAlertBody(subjectValue: string): string {
  return `We no longer track ${subjectValue} at their own request. It stops producing alerts and brief lines here now, not at the next tick.`;
}

function selfAlertBody(subjectValue: string): string {
  return `${subjectValue} is tracked here as your own brand, which a takedown cannot remove. Contact support if you want this workspace changed.`;
}

async function deleteObjectsInBatches(bucket: R2Bucket, keys: string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < keys.length; i += R2_DELETE_BATCH) {
    const batch = keys.slice(i, i + R2_DELETE_BATCH);
    await bucket.delete(batch);
    deleted += batch.length;
  }
  return deleted;
}

export class TakedownWorkflow extends WorkflowEntrypoint<TakedownEnv, TakedownParams> {
  public async run(
    event: Readonly<WorkflowEvent<TakedownParams>>,
    step: WorkflowStep,
  ): Promise<FanOutSummary> {
    return fanOutTakedown(this.env, event.payload.takedownId, step);
  }
}

export async function fanOutTakedown(
  env: TakedownEnv,
  takedownId: string,
  step: WorkflowStep,
): Promise<FanOutSummary> {
  const granted = await step.do("load granted takedown", async () => {
    return env.DB.prepare(SELECT_TAKEDOWN).bind(takedownId).first<TakedownRow>();
  });

  if (granted === null) {
    return {
      takedownId,
      subjectValue: "",
      completedAt: new Date().toISOString(),
      workspaces: [],
      selfWorkspaces: 0,
    };
  }

  const subject = granted.subject_value.trim().toLowerCase();

  if (!isResolvable(granted)) {
    await step.do("park the unresolved row", async () => {
      await env.DB.prepare(PARK_UNRESOLVED).bind(unresolvableNote(granted), granted.id).run();
    });
    return {
      takedownId: granted.id,
      subjectValue: granted.subject_value,
      completedAt: null,
      workspaces: [],
      selfWorkspaces: 0,
    };
  }

  const affected: AffectedWorkspace[] = await step.do("gather affected workspaces", async () => {
    const rows = await env.DB.prepare(SELECT_AFFECTED).bind(subject).all<{
      workspace_id: string;
      entity_id: string;
      entity_role: "self" | "competitor";
      r2_keys: string;
    }>();
    return (rows.results ?? []).map((row) => ({
      workspaceId: row.workspace_id,
      entityId: row.entity_id,
      entityRole: row.entity_role,
      r2Keys: parseKeys(row.r2_keys),
    }));
  });
  const outcomes: WorkspaceOutcome[] = [];
  let selfWorkspaces = 0;

  for (const [index, workspace] of affected.entries()) {
    const outcome = await step.do(
      `remove subject from workspace ${String(index + 1)} of ${String(affected.length)}`,
      { retries: { limit: 5, delay: "1 second", backoff: "exponential" } },
      async () => removeSubject(env, workspace, granted.id, granted.subject_value),
    );
    if (outcome.role === "self") selfWorkspaces += 1;
    outcomes.push(outcome);
  }

  const completedAt = await step.do("record the completed fan-out", async () => {
    const finishedAt = new Date().toISOString();
    const notes: string[] = [];
    if (granted.note !== null && granted.note.length > 0) notes.push(granted.note);
    if (affected.length === 0) {
      notes.push(`no workspace tracks ${granted.subject_value}, so there was nothing to fan out`);
    }
    if (selfWorkspaces > 0) {
      notes.push(
        `${granted.subject_value} is also held as a workspace's own brand: role='self' stays 'on' under the schema CHECK, the owner was alerted, and the subject stays under tracking there.`,
      );
    }
    const combinedNote = notes.length > 0 ? notes.join(" ") : null;

    await env.DB.prepare(SET_FANNED_OUT)
      .bind(finishedAt, combinedNote, granted.id)
      .run();
    return finishedAt;
  });

  return {
    takedownId: granted.id,
    subjectValue: granted.subject_value,
    completedAt,
    workspaces: outcomes,
    selfWorkspaces,
  };
}

async function removeSubject(
  env: TakedownEnv,
  workspace: AffectedWorkspace,
  takedownId: string,
  subjectValue: string,
): Promise<WorkspaceOutcome> {
  const changedAt = new Date().toISOString();

  if (workspace.entityRole === "self") {
    const alertId = await alertOwner(
      env,
      workspace.workspaceId,
      workspace.entityId,
      takedownId,
      selfAlertBody(subjectValue),
      changedAt,
    );
    return {
      workspaceId: workspace.workspaceId,
      role: "self",
      dismissed: false,
      signalsDeleted: 0,
      objectsDeleted: 0,
      alertId,
    };
  }

  await env.DB.prepare(DISMISS_ENTITY).bind(changedAt, workspace.entityId).run();

  const deleted = await env.DB.prepare(DELETE_SIGNALS)
    .bind(workspace.entityId, workspace.workspaceId)
    .run();

  const objectsDeleted = await deleteObjectsInBatches(env.CARD_ARTIFACTS, workspace.r2Keys);

  const alertId = await alertOwner(
    env,
    workspace.workspaceId,
    workspace.entityId,
    takedownId,
    ownerAlertBody(subjectValue),
    changedAt,
  );

  return {
    workspaceId: workspace.workspaceId,
    role: "competitor",
    dismissed: true,
    signalsDeleted: deleted.meta.changes ?? 0,
    objectsDeleted,
    alertId,
  };
}

async function alertOwner(
  env: TakedownEnv,
  workspaceId: string,
  entityId: string,
  takedownId: string,
  body: string,
  changedAt: string,
): Promise<string> {
  const alertId = `alert_takedown_${takedownId}_${entityId}`;
  await env.DB.prepare(INSERT_ALERT)
    .bind(alertId, workspaceId, entityId, ALERT_TITLE, body, changedAt)
    .run();
  return alertId;
}
