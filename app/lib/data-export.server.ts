import { readEmailTarget } from "./data/send_target.server";

const SIGNAL_LIMIT = 10_000;

const SELECT_WORKSPACE = `SELECT name, timezone, brief_weekday, brief_hour, brief_paused_at, own_site_alerts, created_at
FROM workspace WHERE id = ?`;

const SELECT_BRANDS = `SELECT role, domain, name, state, state_changed_at, created_at
FROM entity WHERE workspace_id = ? ORDER BY role, domain`;

const SELECT_SIGNALS = `SELECT e.domain AS brand, s.kind, s.title, s.summary, s.url, s.published_at, s.observed_at
FROM signal s JOIN entity e ON e.id = s.entity_id
WHERE s.workspace_id = ? AND s.is_tombstoned = 0
ORDER BY s.observed_at DESC LIMIT ?`;

const SELECT_BRIEFS = `SELECT subject, period_start, period_end, status, sent_at
FROM digest WHERE workspace_id = ? ORDER BY period_start DESC`;

export async function readWorkspaceExport(db: D1Database, input: { workspaceId: string; email: string; now: Date }) {
  const { workspaceId } = input;
  const [workspace, brands, signals, briefs, target] = await Promise.all([
    db.prepare(SELECT_WORKSPACE).bind(workspaceId).first(),
    db.prepare(SELECT_BRANDS).bind(workspaceId).all(),
    db
      .prepare(SELECT_SIGNALS)
      .bind(workspaceId, SIGNAL_LIMIT + 1)
      .all(),
    db.prepare(SELECT_BRIEFS).bind(workspaceId).all(),
    readEmailTarget(db, workspaceId),
  ]);
  return {
    exportedAt: input.now.toISOString(),
    account: { signInEmail: input.email, briefDeliveryEmail: target?.target_value ?? input.email },
    workspace,
    brands: brands.results,
    signals: signals.results.slice(0, SIGNAL_LIMIT),
    signalsTruncated: signals.results.length > SIGNAL_LIMIT,
    briefs: briefs.results,
  };
}
