import type { AppEnv } from "~/lib/env.server";
import { sendPresenceDigestEmail } from "~/lib/delivery.server";
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
  const items = await listPresenceItems(env, userId, { since, limit: 25 });
  if (items.length === 0) {
    return { delivered: false, reason: "no_items" as const };
  }

  const entities = await listTrackedEntities(env, userId);
  const entityLabels = new Map(entities.map((entity) => [entity.id, entity.label]));
  const lines = items.map((item) => {
    const label = entityLabels.get(item.trackedEntityId) ?? "Tracked entity";
    return `${label} — ${item.title} (${formatCoverageLabel(item.connectorId)})`;
  });

  const subject = `Five to Nine presence brief — ${items.length} update${items.length === 1 ? "" : "s"}`;
  const delivered = await sendPresenceDigestEmail(env, {
    userId,
    email: userEmail,
    subject,
    lines,
    idempotencyKey: `presence-digest:${userId}:${since.slice(0, 10)}`,
  });

  return delivered
    ? { delivered: true as const, itemCount: items.length }
    : { delivered: false, reason: "send_failed" as const };
}
