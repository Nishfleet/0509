import { readPlanSummary } from "./data/plan.server";
import { readEmailTarget } from "./data/send_target.server";

const SIGNAL_LIMIT = 10_000;

const SELECT_WORKSPACE = `SELECT name, timezone, brief_weekday, brief_hour, brief_paused_at, own_site_alerts, created_at
FROM workspace WHERE id = ?`;

const SELECT_OWNER = `SELECT name, email FROM "user" WHERE id = ?`;

const SELECT_SESSIONS = `SELECT createdAt, ipAddress, userAgent FROM session WHERE userId = ? ORDER BY createdAt DESC`;

const SELECT_PASSKEYS = `SELECT name, createdAt, deviceType, backedUp FROM passkey WHERE userId = ?`;

const SELECT_KEYS = `SELECT name, start, prefix, lastRequest, enabled, createdAt FROM apikey WHERE referenceId = ?`;

const SELECT_BRANDS = `SELECT role, domain, name, state, state_changed_at, created_at
FROM entity WHERE workspace_id = ? ORDER BY role, domain`;

const SELECT_CHOICES = `SELECT kind, candidate_domain, candidate_name, status, decided_at
FROM suggestion WHERE workspace_id = ? AND decided_by = 'user' ORDER BY decided_at DESC`;

const SELECT_DECISIONS = `SELECT verdict, note, decided_at FROM user_decision WHERE workspace_id = ? ORDER BY decided_at DESC`;

const SELECT_INCIDENTS = `SELECT kind, opened_at, closed_at FROM incident WHERE workspace_id = ? ORDER BY opened_at DESC`;

const SELECT_SIGNALS = `SELECT e.domain AS brand, s.kind, s.title, s.summary, s.url, s.published_at, s.observed_at
FROM signal s JOIN entity e ON e.id = s.entity_id
WHERE s.workspace_id = ? AND s.is_tombstoned = 0
ORDER BY s.observed_at DESC LIMIT ?`;

const SELECT_BRIEFS = `SELECT subject, period_start, period_end, status, sent_at
FROM digest WHERE workspace_id = ? ORDER BY period_start DESC`;

async function allRows<T extends Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...binds: (string | number)[]
): Promise<T[]> {
  return (
    await db
      .prepare(sql)
      .bind(...binds)
      .all<T>()
  ).results;
}

export async function readWorkspaceExport(
  db: D1Database,
  input: { workspaceId: string; userId: string; email: string; now: Date },
) {
  const { workspaceId, userId } = input;
  const owner = await db.prepare(SELECT_OWNER).bind(userId).first<{ name: string; email: string }>();
  if (owner === null) throw new Error("export owner missing");
  const [workspace, brands, signals, briefs, target, sessions, passkeys, keys, choices, decisions, incidents, plan] =
    await Promise.all([
      db.prepare(SELECT_WORKSPACE).bind(workspaceId).first(),
      allRows(db, SELECT_BRANDS, workspaceId),
      allRows(db, SELECT_SIGNALS, workspaceId, SIGNAL_LIMIT + 1),
      allRows(db, SELECT_BRIEFS, workspaceId),
      readEmailTarget(db, workspaceId),
      allRows(db, SELECT_SESSIONS, userId),
      allRows(db, SELECT_PASSKEYS, userId),
      allRows(db, SELECT_KEYS, userId),
      allRows(db, SELECT_CHOICES, workspaceId),
      allRows(db, SELECT_DECISIONS, workspaceId),
      allRows(db, SELECT_INCIDENTS, workspaceId),
      readPlanSummary(workspaceId),
    ]);
  return {
    exportedAt: input.now.toISOString(),
    account: {
      name: owner.name,
      signInEmail: owner.email,
      briefDeliveryEmail: target?.target_value ?? input.email,
    },
    sessions,
    passkeys,
    agentKeys: keys,
    plan,
    workspace,
    brands,
    choices,
    decisions,
    incidents,
    signals: signals.slice(0, SIGNAL_LIMIT),
    signalsTruncated: signals.length > SIGNAL_LIMIT,
    briefs,
  };
}
