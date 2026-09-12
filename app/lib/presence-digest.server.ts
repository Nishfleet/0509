import type { AppEnv } from "~/lib/env.server";
import { sendPresenceDigestEmail } from "~/lib/delivery.server";
import { buildMentionDigestLines } from "~/lib/mention-digest.server";
import { listPresenceItems, listTrackedEntities } from "~/lib/presence-data.server";
import { formatCoverageLabel } from "~/lib/presence-display";
import { getUserPlan } from "~/lib/plan.server";
import { canUsePresenceFeature } from "~/lib/presence-entitlements";

export async function deliverPresenceDigestForUser(
  env: AppEnv,
  userId: string,
  userEmail: string,
  options: { lookbackHours?: number } = {},
) {
  const digestRollout = env.PRESENCE_DIGEST_ROLLOUT?.trim() ?? "disabled";
  if (digestRollout === "disabled") {
    return { delivered: false, reason: "digest_disabled" as const };
  }

  const { evaluatePresenceWorkspaceAccess } = await import("~/lib/presence-internal-access.server");
  const access = await evaluatePresenceWorkspaceAccess(env, userId);
  if (!access.allowed) {
    return { delivered: false, reason: "workspace_gated" as const };
  }

  const plan = await getUserPlan(env, userId);
  if (!canUsePresenceFeature(plan, "presence_digest_alerts")) {
    return { delivered: false, reason: "plan_gated" as const };
  }

  const lookbackHours = options.lookbackHours ?? 168;
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  const websiteItems = await listPresenceItems(env, userId, { connectorId: "website", since, limit: 25 });
  const mentionLines = await buildMentionDigestLines(env, userId, { since, limit: 25 });

  const entities = await listTrackedEntities(env, userId);
  const entityLabels = new Map(entities.map((entity) => [entity.id, entity.label]));
  const websiteLines = websiteItems.map((item) => {
    const label = entityLabels.get(item.trackedEntityId) ?? "Tracked entity";
    return `${label} — ${item.title} (${formatCoverageLabel(item.connectorId)})`;
  });

  const lines = [...websiteLines, ...mentionLines];
  if (lines.length === 0) {
    return { delivered: false, reason: "no_items" as const };
  }

  const subject = `Five to Nine presence brief — ${lines.length} update${lines.length === 1 ? "" : "s"}`;
  const delivery = await sendPresenceDigestEmail(env, {
    userId,
    email: userEmail,
    subject,
    lines,
    idempotencyKey: `presence-digest:${userId}:${since.slice(0, 10)}`,
  });

  return delivery.delivered
    ? { delivered: true as const, itemCount: lines.length }
    : delivery.accepted
      ? { delivered: false, reason: "delivery_unconfirmed" as const }
      : { delivered: false, reason: "send_failed" as const };
}

export interface PresenceDigestSweepResult {
  /** Workspaces actually attempted (had a delivery address). */
  swept: number;
  delivered: number;
  skipped: number;
  errors: number;
  skippedReason?:
    | "db_unavailable"
    | "inline_mode";
}

const SWEEP_USER_LIMIT = 100;

/**
 * Scheduled presence-digest delivery (epic #3171, #3179).
 *
 * #1379 shipped the digest itself, but nothing outside the integration
 * fixtures ever CALLED it — no workspace received one. This sweep rides the
 * same scheduled monitoring tick as the mention re-sweep (workers/schedule.ts
 * sets includePresenceDigest on the same task) and respects the same
 * MONITORING_FANOUT_MODE: an inline deployment skips it, exactly like
 * runMentionResweep does.
 *
 * The workspace set is the SAME oldest-work-first 100 the re-sweep uses
 * (listResweepUsers), so the heaviest-tail workspaces are swept first. Each
 * delivery is idempotent per workspace per UTC day via the presence-digest
 * idempotency key, so the 3-hourly tick sends at most one digest per
 * workspace per day. Free workspaces carry no presence_digest_alerts feature
 * and are skipped inside deliverPresenceDigestForUser — nothing recurring on
 * Free (#3179); the entity brief on the presence page stays their surface.
 */
export async function runPresenceDigestSweep(
  env: AppEnv,
  options: { userLimit?: number } = {},
): Promise<PresenceDigestSweepResult> {
  const result: PresenceDigestSweepResult = { swept: 0, delivered: 0, skipped: 0, errors: 0 };

  if (!env.DB) {
    result.skippedReason = "db_unavailable";
    return result;
  }

  const { resolveMonitoringFanoutMode } = await import("~/lib/monitoring-fanout.server");
  if (resolveMonitoringFanoutMode(env) === "inline") {
    result.skippedReason = "inline_mode";
    return result;
  }

  const { listResweepUsers } = await import("~/lib/mention-resweep.server");
  const userIds = await listResweepUsers(env, options.userLimit ?? SWEEP_USER_LIMIT);
  if (userIds.length === 0) {
    return result;
  }

  // ONE bounded read: the workspace owner's address, the same `user.email`
  // column the watchlist-digest scheduling SQL resolves. Delivery targets
  // (subscribed inboxes) are resolved later, inside the send path.
  const ownerRows = await env.DB.prepare(
    `SELECT id, email FROM user WHERE id IN (SELECT value FROM json_each(?))`,
  )
    .bind(JSON.stringify(userIds))
    .all<{ id: string; email: string }>();
  const emailByUserId = new Map(
    (ownerRows.results ?? []).map((row) => [String(row.id), String(row.email)]),
  );

  for (const userId of userIds) {
    const email = emailByUserId.get(userId);
    if (!email) {
      result.skipped += 1;
      continue;
    }
    result.swept += 1;
    try {
      const delivery = await deliverPresenceDigestForUser(env, userId, email);
      if (delivery.delivered) {
        result.delivered += 1;
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      result.errors += 1;
      console.log("presence digest delivery failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
