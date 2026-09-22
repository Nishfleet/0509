import { env } from "cloudflare:workers";

export function insertOnboardingRunStmt(
  db: D1Database,
  args: { id: string; workspaceId: string; userId: string; inputRaw: string; now: string },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO onboarding_run (id, workspace_id, user_id, input_raw, started_at, card_ready_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT (id) DO UPDATE SET card_ready_at=excluded.card_ready_at`,
    )
    .bind(args.id, args.workspaceId, args.userId, args.inputRaw, args.now, args.now);
}

export async function latestOnboardingRunId(workspaceId: string): Promise<string | null> {
  const row = await env.DB
    .prepare(`SELECT id FROM onboarding_run WHERE workspace_id = ? ORDER BY started_at DESC LIMIT 1`)
    .bind(workspaceId)
    .first<{ id: string }>();
  return row?.id ?? null;
}
