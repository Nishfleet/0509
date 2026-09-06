/**
 * Mention panel loader — Phase 2 of the mention-monitoring epic (#1368).
 *
 * A read-only composition over existing presence primitives. A "mention" IS a
 * `presence_item` row whose `source_target.connectorId` is one of the entity's
 * enabled mention sources. This loader:
 *   1. applies the existing presence plan gate (free plan on a mode not in
 *      plan → plan-gate empty state, never a fabricated summary),
 *   2. derives the entity's enabled mention connectors from its active
 *      `source_target` rows joined to the source-coverage policy, filtering out
 *      any connector whose coverage label is `UNAVAILABLE` (disabled connectors
 *      are filtered here, at the loader, never rendered as "no data"),
 *   3. fetches `presence_item` rows scoped to `trackedEntityId` for those
 *      connectors only, ordered by `publishedAt DESC` (nulls fall back to
 *      `observedAt`) with a documented default page size.
 *
 * No new write path, no new connector call, no new scheduler entry. The panel
 * works against the Phase 1 RSS connector once it lands; the loader is
 * connector-agnostic over `PresenceConnectorId`.
 */
import type { AppEnv } from "~/lib/env.server";
import { listPresenceItems, listSourceTargetsForEntity } from "~/lib/presence-data.server";
import {
  applyPresenceSourcePlanGates,
  listPresenceSourceCoverage,
} from "~/lib/presence-source-coverage.server";
import {
  canUsePresenceFeature,
  presenceModeAllowed,
} from "~/lib/presence-entitlements";
import type { PlanFamily } from "~/lib/plan-entitlements";
import type {
  PresenceConnectorId,
  PresenceCoverageLabel,
  PresenceTrackingMode,
} from "~/lib/presence-types";

/**
 * Default page size for the mention panel. Documented and pinned so the test
 * can assert there IS a default. The exact value is advisory (issue #1377);
 * 25 keeps the panel cheap while covering a typical "latest mentions" glance.
 */
export const MENTION_PANEL_DEFAULT_PAGE_SIZE = 25;

export interface MentionPanelItem {
  id: string;
  connectorId: PresenceConnectorId;
  coverageLabel: PresenceCoverageLabel;
  canonicalUrl: string;
  title: string;
  bodyExcerpt: string | null;
  author: string | null;
  publishedAt: string | null;
  observedAt: string;
}

/**
 * The panel states the loader can return. Each maps to exactly one render path
 * in `mention-panel.tsx`:
 *   - `mentions`: enabled sources exist and at least one polled item was found.
 *   - `empty-no-sources`: the entity has no enabled mention sources (no active
 *     `source_target` on a live connector). Honest empty state.
 *   - `empty-no-items`: enabled sources exist but no polled items yet. Honest
 *     empty state — never a fabricated mention.
 *   - `plan-gated`: the entity's tracking mode is not in the current plan
 *     (e.g. free plan on competitor mode). Plan-gate empty state from
 *     `presence-entitlements.ts`, never a fabricated mentions summary.
 */
export type MentionPanelState =
  | "mentions"
  | "empty-no-sources"
  | "empty-no-items"
  | "plan-gated";

export interface MentionPanelLoaderResult {
  state: MentionPanelState;
  items: MentionPanelItem[];
  enabledConnectorIds: PresenceConnectorId[];
  pageSize: number;
  /** The presence plan feature that would unlock a `plan-gated` state, else null. */
  planGateFeature: PresencePlanFeatureKey | null;
}

export type PresencePlanFeatureKey =
  | "presence_self_tracking"
  | "presence_competitor_tracking";

export interface MentionPanelLoaderInput {
  env: AppEnv;
  workspaceUserId: string;
  trackedEntityId: string;
  trackingMode: PresenceTrackingMode;
  planFamily: PlanFamily;
  pageSize?: number;
}

/**
 * Load the mention panel data for a single tracked entity. Read-only.
 */
export async function loadMentionPanel(
  input: MentionPanelLoaderInput,
): Promise<MentionPanelLoaderResult> {
  const pageSize = clampPageSize(input.pageSize);

  // Plan gate first: a mode not in plan never reaches the data layer. This is
  // the plan-respect eval (3.6) — free plan on competitor mode renders the
  // plan-gate empty state, not a fabricated mentions summary.
  if (!presenceModeAllowed(input.planFamily, input.trackingMode)) {
    return {
      state: "plan-gated",
      items: [],
      enabledConnectorIds: [],
      pageSize,
      planGateFeature:
        input.trackingMode === "self"
          ? "presence_self_tracking"
          : "presence_competitor_tracking",
    };
  }

  const sourcePlanGates = {
    modeAllowed: true,
    websiteSourcesAllowed: canUsePresenceFeature(input.planFamily, "presence_website_sources"),
    socialConnectAllowed: canUsePresenceFeature(input.planFamily, "presence_social_connect"),
  };

  const sources = await listSourceTargetsForEntity(
    input.env,
    input.workspaceUserId,
    input.trackedEntityId,
  );

  // Join the coverage label from the source-coverage policy, with plan gates
  // applied so a social connector on a plan without social_connect reads as
  // UNAVAILABLE and is filtered out at the loader.
  const rawCoverage = await listPresenceSourceCoverage(
    input.env,
    input.trackingMode,
    input.workspaceUserId,
  );
  const coverage = applyPresenceSourcePlanGates(rawCoverage, sourcePlanGates);
  const liveCoverageLabelByConnector = new Map<PresenceConnectorId, PresenceCoverageLabel>();
  for (const entry of coverage) {
    if (
      entry.connectorId &&
      entry.coverageLabel &&
      entry.coverageLabel !== "UNAVAILABLE"
    ) {
      liveCoverageLabelByConnector.set(entry.connectorId, entry.coverageLabel);
    }
  }

  // Enabled mention sources = active source targets on a live (non-UNAVAILABLE)
  // connector. Disabled connectors are filtered here, never rendered as "no data".
  const enabledSources = sources.filter((source) =>
    liveCoverageLabelByConnector.has(source.connectorId),
  );
  const enabledConnectorIds = uniqueConnectorIds(
    enabledSources.map((source) => source.connectorId),
  );

  if (enabledSources.length === 0) {
    return {
      state: "empty-no-sources",
      items: [],
      enabledConnectorIds: [],
      pageSize,
      planGateFeature: null,
    };
  }

  // Fetch items per enabled connector (`listPresenceItems` takes a single
  // connectorId), then merge and order by publishedAt DESC. The loader returns
  // ONLY items whose connectorId is one of the entity's enabled connectorIds.
  const perConnector = await Promise.all(
    enabledConnectorIds.map((connectorId) =>
      listPresenceItems(input.env, input.workspaceUserId, {
        trackedEntityId: input.trackedEntityId,
        connectorId,
        limit: pageSize,
      }),
    ),
  );

  const items = perConnector
    .flat()
    .filter((item) => liveCoverageLabelByConnector.has(item.connectorId))
    .map((item) => ({
      id: item.id,
      connectorId: item.connectorId,
      coverageLabel: liveCoverageLabelByConnector.get(item.connectorId) ?? "UNAVAILABLE",
      canonicalUrl: item.canonicalUrl,
      title: item.title,
      bodyExcerpt: item.bodyExcerpt,
      author: item.author,
      publishedAt: item.publishedAt,
      observedAt: item.observedAt,
    }))
    .sort(orderByPublishedAtDesc);

  if (items.length === 0) {
    return {
      state: "empty-no-items",
      items: [],
      enabledConnectorIds,
      pageSize,
      planGateFeature: null,
    };
  }

  return {
    state: "mentions",
    items: items.slice(0, pageSize),
    enabledConnectorIds,
    pageSize,
    planGateFeature: null,
  };
}

function clampPageSize(value: number | undefined): number {
  return Math.min(Math.max(value ?? MENTION_PANEL_DEFAULT_PAGE_SIZE, 1), 200);
}

function uniqueConnectorIds(values: PresenceConnectorId[]): PresenceConnectorId[] {
  return Array.from(new Set(values));
}

/**
 * Order by publishedAt DESC. A null publishedAt falls back to observedAt so
 * every item has a deterministic sort key; ties keep insertion order (stable).
 */
function orderByPublishedAtDesc(
  a: Pick<MentionPanelItem, "publishedAt" | "observedAt">,
  b: Pick<MentionPanelItem, "publishedAt" | "observedAt">,
): number {
  const aKey = a.publishedAt ?? a.observedAt;
  const bKey = b.publishedAt ?? b.observedAt;
  if (aKey < bKey) return 1;
  if (aKey > bKey) return -1;
  return 0;
}
