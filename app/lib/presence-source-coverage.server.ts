import type { AppEnv } from "~/lib/env.server";
import {
  connectorHasCustomerPollPath,
  evaluateConnectorAccessGate,
} from "~/lib/presence-access-gates.server";
import type {
  PresenceConnectorId,
  PresenceCoverageLabel,
  PresencePollCursorRecord,
  PresenceSourceCoverageEntry,
  PresenceSourceCoverageStatus,
  PresenceSourceId,
  PresenceTrackingMode,
  SourceTargetRecord,
} from "~/lib/presence-types";

const SOURCE_LABELS: Record<PresenceSourceId, string> = {
  website: "Website / open web",
  x: "X",
  reddit: "Reddit",
  linkedin: "LinkedIn",
  rss: "RSS / Atom / JSON Feed",
  youtube: "YouTube",
  amazon: "Amazon marketplace",
  context_dev: "Context.dev (open-web provider)",
};

const CONNECTOR_FOR_SOURCE: Partial<Record<PresenceSourceId, PresenceConnectorId>> = {
  website: "website",
  x: "x",
  reddit: "reddit",
  linkedin: "linkedin",
  rss: "rss",
};

const SOCIAL_SOURCE_IDS = new Set<PresenceSourceId>(["x", "reddit", "linkedin"]);

export interface PresenceSourcePlanGates {
  modeAllowed: boolean;
  websiteSourcesAllowed: boolean;
  socialConnectAllowed: boolean;
}

function isKnownSourceId(value: string): value is PresenceSourceId {
  return value in SOURCE_LABELS;
}

function baseEntry(
  sourceId: PresenceSourceId,
  status: PresenceSourceCoverageStatus,
  options: {
    coverageLabel?: PresenceCoverageLabel | null;
    reasonCode?: string | null;
    reasonMessage?: string | null;
    actionNeeded?: string | null;
  } = {},
): PresenceSourceCoverageEntry {
  return {
    sourceId,
    label: SOURCE_LABELS[sourceId],
    status,
    coverageLabel: options.coverageLabel ?? null,
    reasonCode: options.reasonCode ?? null,
    reasonMessage: options.reasonMessage ?? null,
    actionNeeded: options.actionNeeded ?? null,
    connectorId: CONNECTOR_FOR_SOURCE[sourceId] ?? null,
  };
}

function statusFromConnectorGate(
  sourceId: PresenceSourceId,
  gate: Awaited<ReturnType<typeof evaluateConnectorAccessGate>>,
  trackingMode: PresenceTrackingMode,
): PresenceSourceCoverageEntry {
  if (gate.allowed) {
    const coverageLabel: PresenceCoverageLabel =
      sourceId === "website"
        ? "PUBLIC_WEB_BEST_EFFORT"
        : sourceId === "rss"
          ? "VERIFIED_PUBLIC_FEED"
          : sourceId === "linkedin" && trackingMode === "competitor"
            ? "LIMITED_COVERAGE"
            : sourceId === "x" || sourceId === "reddit"
              ? trackingMode === "self"
                ? "CONNECTED_ACCOUNT"
                : "OFFICIAL_PUBLIC_API"
              : "CONNECTED_ACCOUNT";

    return baseEntry(sourceId, "available", {
      coverageLabel,
      reasonCode: gate.reasonCode,
      reasonMessage: gate.reasonMessage,
      actionNeeded: "Add a source target",
    });
  }

  if (gate.reasonCode === "competitor_limited") {
    return baseEntry(sourceId, "limited", {
      coverageLabel: "LIMITED_COVERAGE",
      reasonCode: gate.reasonCode,
      reasonMessage: gate.reasonMessage,
      actionNeeded: "Self-brand tracking only for this source",
    });
  }

  if (gate.rolloutState === "disabled") {
    return baseEntry(sourceId, "unavailable", {
      coverageLabel: "UNAVAILABLE",
      reasonCode: gate.reasonCode,
      reasonMessage: gate.reasonMessage,
      actionNeeded: null,
    });
  }

  return baseEntry(sourceId, "gated", {
    coverageLabel: "UNAVAILABLE",
    reasonCode: gate.reasonCode,
    reasonMessage: gate.reasonMessage,
    actionNeeded: gate.reasonMessage,
  });
}

async function evaluateConnectorSourceCoverage(
  env: AppEnv,
  sourceId: PresenceSourceId,
  trackingMode: PresenceTrackingMode,
  workspaceUserId?: string,
): Promise<PresenceSourceCoverageEntry> {
  const connectorId = CONNECTOR_FOR_SOURCE[sourceId];
  if (!connectorId) {
    return baseEntry(sourceId, "unavailable", {
      reasonCode: "unknown_source",
      reasonMessage: `${sourceId} is not a configured connector.`,
    });
  }

  const gate = await evaluateConnectorAccessGate(env, connectorId, trackingMode, workspaceUserId);
  if (gate.allowed && SOCIAL_SOURCE_IDS.has(sourceId) && !connectorHasCustomerPollPath(connectorId)) {
    return baseEntry(sourceId, "unavailable", {
      coverageLabel: "UNAVAILABLE",
      reasonCode: "poll_not_implemented",
      reasonMessage: `${SOURCE_LABELS[sourceId]} polling is not active for customer-facing coverage yet.`,
      actionNeeded: null,
    });
  }
  return statusFromConnectorGate(sourceId, gate, trackingMode);
}

function evaluatePlannedSourceCoverage(sourceId: PresenceSourceId): PresenceSourceCoverageEntry {
  if (sourceId === "youtube") {
    return baseEntry(sourceId, "planned", {
      coverageLabel: "UNAVAILABLE",
      reasonCode: "api_not_configured",
      reasonMessage: "YouTube tracking requires official API credentials, quota approval, and a rollout decision.",
      actionNeeded: "Not available yet — requires API key and product approval",
    });
  }

  if (sourceId === "amazon") {
    return baseEntry(sourceId, "manual_only", {
      coverageLabel: "LIMITED_COVERAGE",
      reasonCode: "manual_proof_required",
      reasonMessage: "Automated Amazon marketplace monitoring is not launched. Manual proof capture or approved affiliate API use only.",
      actionNeeded: "Add manual proof or request approval for affiliate/product API access",
    });
  }

  if (sourceId === "context_dev") {
    return baseEntry(sourceId, "planned", {
      coverageLabel: "UNAVAILABLE",
      reasonCode: "provider_not_configured",
      reasonMessage: "Context.dev is an optional backend open-web provider. It is not required for website tracking and is not active until configured and approved.",
      actionNeeded: null,
    });
  }

  return baseEntry(sourceId, "unavailable", {
    reasonCode: "unknown_source",
    reasonMessage: `${sourceId} is not supported.`,
  });
}

function policyAllowsConnectedTargets(status: PresenceSourceCoverageStatus): boolean {
  return status === "active" || status === "available" || status === "connected";
}

function strongestCoverageLabel(targets: SourceTargetRecord[]): PresenceCoverageLabel {
  const labels = new Set(targets.map((target) => target.coverageLabel));
  if (labels.has("CONNECTED_ACCOUNT")) return "CONNECTED_ACCOUNT";
  if (labels.has("OFFICIAL_PUBLIC_API")) return "OFFICIAL_PUBLIC_API";
  if (labels.has("VERIFIED_PUBLIC_FEED")) return "VERIFIED_PUBLIC_FEED";
  if (labels.has("PUBLIC_WEB_BEST_EFFORT")) return "PUBLIC_WEB_BEST_EFFORT";
  if (labels.has("LIMITED_COVERAGE")) return "LIMITED_COVERAGE";
  return "UNAVAILABLE";
}

export async function evaluatePresenceSourceCoverage(
  env: AppEnv,
  sourceId: PresenceSourceId,
  trackingMode: PresenceTrackingMode,
  workspaceUserId?: string,
): Promise<PresenceSourceCoverageEntry> {
  if (!isKnownSourceId(sourceId)) {
    return baseEntry("website", "unavailable", {
      reasonCode: "unknown_source",
      reasonMessage: `Unknown source: ${sourceId}`,
    });
  }

  if (CONNECTOR_FOR_SOURCE[sourceId]) {
    return evaluateConnectorSourceCoverage(env, sourceId, trackingMode, workspaceUserId);
  }

  return evaluatePlannedSourceCoverage(sourceId);
}

export async function listPresenceSourceCoverage(
  env: AppEnv,
  trackingMode: PresenceTrackingMode,
  workspaceUserId?: string,
): Promise<PresenceSourceCoverageEntry[]> {
  return Promise.all(
    (Object.keys(SOURCE_LABELS) as PresenceSourceId[]).map((sourceId) =>
      evaluatePresenceSourceCoverage(env, sourceId, trackingMode, workspaceUserId),
    ),
  );
}

export function applyPresenceSourcePlanGates(
  entries: PresenceSourceCoverageEntry[],
  gates: PresenceSourcePlanGates,
): PresenceSourceCoverageEntry[] {
  return entries.map((entry) => {
    if (!gates.modeAllowed) {
      return {
        ...entry,
        status: "unavailable",
        coverageLabel: "UNAVAILABLE",
        reasonCode: "mode_not_in_plan",
        reasonMessage: "This entity mode is not included in the current plan.",
        actionNeeded: "Upgrade plan to enable this entity type",
      };
    }

    if (entry.sourceId === "website" && !gates.websiteSourcesAllowed) {
      return {
        ...entry,
        status: "unavailable",
        coverageLabel: "UNAVAILABLE",
        reasonCode: "website_sources_not_in_plan",
        reasonMessage: "Website presence sources are not included in the current plan.",
        actionNeeded: "Upgrade plan to enable website sources",
      };
    }

    if (
      SOCIAL_SOURCE_IDS.has(entry.sourceId) &&
      !gates.socialConnectAllowed &&
      (entry.status === "active" || entry.status === "available" || entry.status === "connected")
    ) {
      return {
        ...entry,
        status: "gated",
        coverageLabel: "UNAVAILABLE",
        reasonCode: "social_connect_not_in_plan",
        reasonMessage: "Social presence connections are not included in the current plan.",
        actionNeeded: "Upgrade plan to enable social source connections",
      };
    }

    return entry;
  });
}

export function applyEntitySourceTargetCoverage(
  policyEntry: PresenceSourceCoverageEntry,
  target: SourceTargetRecord | null | undefined,
  cursor: PresencePollCursorRecord | null | undefined,
): PresenceSourceCoverageEntry {
  return applyEntitySourceTargetsCoverage(
    policyEntry,
    target ? [target] : [],
    target ? [{ sourceTargetId: target.id, cursor: cursor ?? null }] : [],
  );
}

export function applyEntitySourceTargetsCoverage(
  policyEntry: PresenceSourceCoverageEntry,
  targets: SourceTargetRecord[],
  cursors: Array<{ sourceTargetId: string; cursor: PresencePollCursorRecord | null | undefined }>,
): PresenceSourceCoverageEntry {
  const activeTargets = targets.filter((target) => target.isActive);
  if (activeTargets.length === 0) {
    return policyEntry;
  }

  if (!policyAllowsConnectedTargets(policyEntry.status)) {
    return policyEntry;
  }

  const cursorByTarget = new Map(cursors.map((entry) => [entry.sourceTargetId, entry.cursor ?? null]));
  const degradedTarget = activeTargets
    .map((target) => ({ target, cursor: cursorByTarget.get(target.id) ?? null }))
    .find((entry) => entry.cursor?.lastErrorCode);

  if (degradedTarget?.cursor?.lastErrorCode && !degradedTarget.cursor.lastSuccessAt) {
    return {
      ...policyEntry,
      status: "degraded",
      coverageLabel: degradedTarget.target.coverageLabel,
      reasonCode: degradedTarget.cursor.lastErrorCode,
      reasonMessage: degradedTarget.cursor.lastErrorMessage ?? "Last poll failed for this source.",
      actionNeeded: "Check source or retry poll",
    };
  }

  if (degradedTarget?.cursor?.lastErrorCode && degradedTarget.cursor.lastSuccessAt) {
    return {
      ...policyEntry,
      status: "degraded",
      coverageLabel: degradedTarget.target.coverageLabel,
      reasonCode: degradedTarget.cursor.lastErrorCode,
      reasonMessage: degradedTarget.cursor.lastErrorMessage ?? "Latest poll hit a limitation.",
      actionNeeded: "Review source limitation",
    };
  }

  const unpolledCount = activeTargets.filter((target) => !cursorByTarget.get(target.id)?.lastPolledAt).length;

  return {
    ...policyEntry,
    status: "connected",
    coverageLabel: strongestCoverageLabel(activeTargets),
    reasonCode: null,
    reasonMessage: null,
    actionNeeded:
      unpolledCount > 0
        ? `Run first check for ${unpolledCount} source target${unpolledCount === 1 ? "" : "s"}`
        : null,
  };
}

export function presenceSourceCoverageForDocs(): Array<{
  sourceId: PresenceSourceId;
  label: string;
  productionStatus: string;
  notes: string;
}> {
  return [
    {
      sourceId: "website",
      label: SOURCE_LABELS.website,
      productionStatus: "active",
      notes: "GA for entitled workspaces. Safe fetch, robots handling, bounded responses.",
    },
    {
      sourceId: "x",
      label: SOURCE_LABELS.x,
      productionStatus: "unavailable",
      notes: "Requires paid API credentials, rollout decision, and rate-limit approval.",
    },
    {
      sourceId: "reddit",
      label: SOURCE_LABELS.reddit,
      productionStatus: "unavailable",
      notes: "Requires commercial API access approval and credentials.",
    },
    {
      sourceId: "linkedin",
      label: SOURCE_LABELS.linkedin,
      productionStatus: "unavailable",
      notes: "Self-brand OAuth only when rolled out. Competitor tracking is limited.",
    },
    {
      sourceId: "rss",
      label: SOURCE_LABELS.rss,
      productionStatus: "gated",
      notes: "RSS/Atom/JSON Feed connector wired in. Gated behind PRESENCE_RSS_ROLLOUT — off by default; activation is a separate rollout decision.",
    },
    {
      sourceId: "youtube",
      label: SOURCE_LABELS.youtube,
      productionStatus: "planned",
      notes: "Requires official API key, quota, and product approval before any active claim.",
    },
    {
      sourceId: "amazon",
      label: SOURCE_LABELS.amazon,
      productionStatus: "manual_only",
      notes: "No automated generic marketplace scraping. Manual proof or approved affiliate API only.",
    },
    {
      sourceId: "context_dev",
      label: SOURCE_LABELS.context_dev,
      productionStatus: "planned",
      notes: "Optional backend open-web provider. Not a platform-policy bypass.",
    },
  ];
}
