import type { AppEnv } from "~/lib/env.server";
import { getUserPlan } from "~/lib/plan.server";
import { isPaidPlanFamily } from "~/lib/plan-entitlements";
import {
  connectorOperationalForPolling,
  evaluateConnectorAccessGate,
} from "~/lib/presence-access-gates.server";
import { rssConnector } from "~/lib/presence-connectors/rss.server";
import {
  getPollCursor,
  listSourceTargetsForEntity,
  listTrackedEntities,
  updateSourceTargetCoverageLabel,
  upsertPollCursor,
  upsertPresenceItems,
} from "~/lib/presence-data.server";
import { presenceModeAllowed } from "~/lib/presence-entitlements";
import { resolveMonitoringFanoutMode } from "~/lib/monitoring-fanout.server";
import type {
  PresenceConnectorContext,
  SourceTargetRecord,
} from "~/lib/presence-types";

export interface MentionResweepOptions {
  /** Limit how many workspaces (users) to sweep in one run. */
  userLimit?: number;
  /** Override `fetch` for tests; production uses the global. */
  fetchImpl?: typeof fetch;
  /** If set, sweep only this user; otherwise sweep all paid users with tracked entities. */
  userId?: string;
}

export interface MentionResweepResult {
  entities: number;
  errors: number;
  inserted: number;
  polled: number;
  skipped: number;
  skippedReason?: string;
  updated: number;
}

const DEFAULT_USER_LIMIT = 100;

/**
 * Workspaces ordered by oldest work first. `presence_poll_cursor` is keyed by
 * `source_target_id`, so `MIN(last_polled_at)` is the workspace's oldest *poll*;
 * a workspace with no cursor at all sorts first (`NULLS FIRST`). `user_id ASC`
 * breaks ties deterministically. Ordering by identity instead would re-poll the
 * same 100 alphabetical workspaces forever and starve the rest (issue #2457).
 *
 * Caveat: a workspace with one very old poll and one never-polled source still
 * sorts by its old poll, so `NULLS FIRST` only rescues workspaces with no
 * cursors at all. That is deliberate — ordering by source would split a
 * workspace across the limit, and the limit counts workspaces.
 */
export async function listResweepUsers(env: AppEnv, limit: number): Promise<string[]> {
  if (!env.DB) return [];
  const rows = await env.DB
    .prepare(
      `SELECT te.user_id AS user_id,
              MIN(pc.last_polled_at) AS oldest_polled_at
       FROM tracked_entity te
       LEFT JOIN source_target st
         ON st.tracked_entity_id = te.id
        AND st.is_active = 1
        AND st.deleted_at IS NULL
       LEFT JOIN presence_poll_cursor pc
         ON pc.source_target_id = st.id
       WHERE te.is_active = 1 AND te.deleted_at IS NULL
       GROUP BY te.user_id
       ORDER BY (oldest_polled_at IS NULL) DESC, oldest_polled_at ASC, te.user_id ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<{ user_id: string }>();
  return (rows.results ?? []).map((row) => String(row.user_id));
}

/**
 * Periodic mention re-sweep. Re-polls the RSS feeds discoverable from active
 * `website` source targets and stores the results as `rss` `presence_item` rows
 * without needing a `connector_id = 'rss'` `source_target` row — migration 0055
 * still forbids that value, and the issue forbids schema changes.
 *
 * The sweep routes through the existing monitoring fan-out scheduling surface:
 * it is called from `runScheduledMonitoring` when `includeMentionResweep` is
 * true, and it respects `MONITORING_FANOUT_MODE` and paid-tier plan gating.
 */
export async function runMentionResweep(
  env: AppEnv,
  options: MentionResweepOptions = {},
): Promise<MentionResweepResult> {
  const result: MentionResweepResult = {
    entities: 0,
    errors: 0,
    inserted: 0,
    polled: 0,
    skipped: 0,
    updated: 0,
  };

  if (!env.DB) {
    result.skippedReason = "db_unavailable";
    return result;
  }

  const fanoutMode = resolveMonitoringFanoutMode(env);
  if (fanoutMode === "inline") {
    result.skippedReason = "inline_mode";
    return result;
  }

  const userIds = options.userId
    ? [options.userId]
    : await listResweepUsers(env, options.userLimit ?? DEFAULT_USER_LIMIT);

  for (const userId of userIds) {
    const plan = await getUserPlan(env, userId);
    if (!isPaidPlanFamily(plan)) {
      result.skipped += 1;
      continue;
    }

    const entities = await listTrackedEntities(env, userId);
    for (const entity of entities) {
      if (!entity.isActive) continue;
      if (!presenceModeAllowed(plan, entity.trackingMode)) continue;

      const sources = await listSourceTargetsForEntity(env, userId, entity.id);
      for (const source of sources) {
        if (source.connectorId !== "website") continue;
        if (!(await isRssResweepOperational(env, source, entity.trackingMode, userId))) {
          continue;
        }

        result.polled += 1;
        try {
          const sweep = await resweepRssForWebsiteTarget(env, {
            entity,
            fetchImpl: options.fetchImpl,
            source,
            userId,
          });
          result.inserted += sweep.inserted;
          result.updated += sweep.updated;
        } catch (error) {
          result.errors += 1;
          console.log("mention resweep failed for source", {
            userId,
            entityId: entity.id,
            sourceId: source.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      result.entities += 1;
    }
  }

  return result;
}

async function isRssResweepOperational(
  env: AppEnv,
  source: SourceTargetRecord,
  trackingMode: "self" | "competitor",
  userId: string,
) {
  if (!source.targetUrl) return false;
  if (!(await connectorOperationalForPolling(env, "rss", trackingMode, userId))) return false;
  const gate = await evaluateConnectorAccessGate(env, "rss", trackingMode, userId);
  return gate.allowed;
}

interface ResweepSourceInput {
  entity: { id: string; trackingMode: "self" | "competitor" };
  fetchImpl?: typeof fetch;
  source: SourceTargetRecord;
  userId: string;
}

interface ResweepSourceStats {
  inserted: number;
  updated: number;
}

async function resweepRssForWebsiteTarget(
  env: AppEnv,
  input: ResweepSourceInput,
): Promise<ResweepSourceStats> {
  const { source, entity, userId, fetchImpl } = input;
  const ctx: PresenceConnectorContext = {
    env,
    userId,
    trackingMode: entity.trackingMode,
    connection: null,
    fetchImpl,
  };

  const validated = await rssConnector.validateTarget(
    { trackingMode: entity.trackingMode, targetUrl: source.targetUrl ?? undefined },
    ctx,
  );

  if (!validated.ok) {
    return { inserted: 0, updated: 0 };
  }

  const feedUrl =
    typeof validated.metadata?.feedUrl === "string"
      ? validated.metadata.feedUrl
      : source.targetUrl;

  if (typeof feedUrl !== "string" || !feedUrl) {
    return { inserted: 0, updated: 0 };
  }

  const cursor = await getPollCursor(env, source.id);
  const pollResult = await rssConnector.poll(
    ctx,
    { targetUrl: feedUrl, metadata: { ...source.metadata, feedUrl } },
    cursor
      ? { etag: cursor.etag, lastModified: cursor.lastModified }
      : undefined,
  );

  if (!pollResult.ok) {
    await upsertPollCursor(env, source.id, {
      cursor: cursor?.cursor ?? { feedUrl },
      etag: pollResult.etag ?? cursor?.etag ?? null,
      lastModified: pollResult.lastModified ?? cursor?.lastModified ?? null,
      lastPolledAt: new Date().toISOString(),
      lastSuccessAt: cursor?.lastSuccessAt ?? null,
      lastErrorCode: pollResult.errorCode ?? "poll_failed",
      lastErrorMessage: pollResult.errorMessage ?? null,
    });
    return { inserted: 0, updated: 0 };
  }

  // Store the feed items under the existing website source_target row but with
  // connector_id = 'rss'. This reuses the existing source_target row because
  // migration 0055's CHECK constraint does not yet allow 'rss'.
  const rssSourceTarget: SourceTargetRecord = {
    ...source,
    connectorId: "rss",
    coverageLabel: "VERIFIED_PUBLIC_FEED",
    metadata: { ...source.metadata, feedUrl },
  };

  const upsertStats = await upsertPresenceItems(env, {
    sourceTarget: rssSourceTarget,
    items: pollResult.items,
  });

  if (
    pollResult.coverageLabel &&
    pollResult.coverageLabel !== source.coverageLabel
  ) {
    await updateSourceTargetCoverageLabel(env, userId, source.id, pollResult.coverageLabel);
  }

  const now = new Date().toISOString();
  await upsertPollCursor(env, source.id, {
    cursor: {
      ...(pollResult.cursor ?? cursor?.cursor ?? {}),
      feedUrl,
    },
    etag: pollResult.etag ?? cursor?.etag ?? null,
    lastModified: pollResult.lastModified ?? cursor?.lastModified ?? null,
    lastPolledAt: now,
    lastSuccessAt: now,
    lastErrorCode: null,
    lastErrorMessage: null,
  });

  return upsertStats;
}
