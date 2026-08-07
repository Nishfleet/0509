import type {
  PresenceItemRecord,
  PresencePollCursorRecord,
  PresenceSourceCoverageEntry,
  SourceTargetRecord,
  TrackedEntityRecord,
} from "~/lib/presence-types";

export const PRESENCE_ENTITY_BRIEF_STATES = [
  "not_enough_data",
  "queued",
  "all_quiet",
  "ready",
  "source_unavailable",
  "manual_proof_needed",
  "degraded",
] as const;

export type PresenceEntityBriefState = (typeof PRESENCE_ENTITY_BRIEF_STATES)[number];

export interface PresenceEntityBriefChange {
  id: string;
  title: string;
  canonicalUrl: string;
  connectorId: string;
  observedAt: string;
  coverageLabel: string | null;
}

export interface PresenceEntityBriefNextAction {
  label: string;
  href?: string;
}

export interface PresenceEntityBrief {
  state: PresenceEntityBriefState;
  headline: string;
  summary: string;
  proofStrength: string;
  sourceConfidence: string;
  nextAction: PresenceEntityBriefNextAction;
  recentChanges: PresenceEntityBriefChange[];
  sourceCoverage: PresenceSourceCoverageEntry[];
  lastPollAt: string | null;
  lastChangeAt: string | null;
}

const WEBSITE_OPEN_WEB_SOURCES = new Set(["website"]);
export interface BuildPresenceEntityBriefInput {
  entity: TrackedEntityRecord;
  sources: SourceTargetRecord[];
  items: PresenceItemRecord[];
  sourceCoverage: PresenceSourceCoverageEntry[];
  pollCursors?: Array<{ sourceTargetId: string; cursor: PresencePollCursorRecord | null }>;
  /** Only website/open-web sources are briefed in the first slice. */
  activeSourceIds?: Set<string>;
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const valid = values.filter((value): value is string => Boolean(value));
  if (valid.length === 0) {
    return null;
  }
  return valid.sort((a, b) => b.localeCompare(a))[0] ?? null;
}

function websiteSources(
  sources: SourceTargetRecord[],
  activeSourceIds: Set<string>,
): SourceTargetRecord[] {
  return sources.filter(
    (source) => source.isActive && activeSourceIds.has(source.connectorId) && WEBSITE_OPEN_WEB_SOURCES.has(source.connectorId),
  );
}

function cursorForTarget(
  pollCursors: BuildPresenceEntityBriefInput["pollCursors"],
  sourceTargetId: string,
): PresencePollCursorRecord | null {
  return pollCursors?.find((entry) => entry.sourceTargetId === sourceTargetId)?.cursor ?? null;
}

function proofStrengthFromItems(items: PresenceItemRecord[], sources: SourceTargetRecord[]): string {
  if (items.length === 0) {
    return "No proof-backed changes yet";
  }
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const labels = new Set(
    items
      .map((item) => sourceById.get(item.sourceTargetId)?.coverageLabel)
      .filter((label): label is SourceTargetRecord["coverageLabel"] => Boolean(label)),
  );
  if (labels.has("VERIFIED_PUBLIC_FEED")) {
    return "Verified public feed";
  }
  if (labels.has("PUBLIC_WEB_BEST_EFFORT")) {
    return "Public web — best effort";
  }
  return "Proof-backed public content";
}

function sourceConfidenceFromCoverage(coverage: PresenceSourceCoverageEntry[]): string {
  const website = coverage.find((entry) => entry.sourceId === "website");
  if (!website) {
    return "Website coverage not evaluated";
  }
  if (website.status === "connected" || website.status === "active") {
    return website.coverageLabel === "VERIFIED_PUBLIC_FEED"
      ? "High — verified feed"
      : "Moderate — public web best effort";
  }
  if (website.status === "degraded") {
    return "Low — source degraded";
  }
  if (website.status === "available" || website.status === "gated") {
    return "Pending — add or connect website source";
  }
  return "Unavailable — website source not active";
}

function cursorStringValue(cursor: PresencePollCursorRecord | null | undefined, key: string): string | null {
  const value = cursor?.cursor?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function targetChangedInLatestPoll(cursor: PresencePollCursorRecord | null | undefined): boolean {
  const lastChangedAt = cursorStringValue(cursor, "lastChangedAt");
  return Boolean(
    lastChangedAt &&
      cursor?.lastPolledAt &&
      cursor.lastSuccessAt &&
      !cursor.lastErrorCode &&
      lastChangedAt === cursor.lastSuccessAt &&
      cursor.lastPolledAt === cursor.lastSuccessAt,
  );
}

function cursorStringArrayValue(cursor: PresencePollCursorRecord | null | undefined, key: string): Set<string> {
  const value = cursor?.cursor?.[key];
  if (!Array.isArray(value)) {
    return new Set();
  }
  return new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0));
}

function cursorNumberValue(cursor: PresencePollCursorRecord | null | undefined, key: string): number {
  const value = cursor?.cursor?.[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function buildPresenceEntityBrief(input: BuildPresenceEntityBriefInput): PresenceEntityBrief {
  const activeSourceIds = input.activeSourceIds ?? WEBSITE_OPEN_WEB_SOURCES;
  const scopedSources = websiteSources(input.sources, activeSourceIds);
  const scopedSourceTargetIds = new Set(scopedSources.map((source) => source.id));
  const scopedCoverage = input.sourceCoverage.filter((entry) => activeSourceIds.has(entry.sourceId));
  const pollTimes = scopedSources.map((source) =>
    cursorForTarget(input.pollCursors, source.id)?.lastPolledAt ?? null,
  );
  const lastPollAt = latestTimestamp(pollTimes);
  const cursorByTarget = new Map(
    scopedSources.map((source) => [source.id, cursorForTarget(input.pollCursors, source.id)]),
  );
  const latestPollChangeCount = scopedSources.reduce((total, source) => {
    const cursor = cursorByTarget.get(source.id);
    return targetChangedInLatestPoll(cursor) ? total + cursorNumberValue(cursor, "lastChangeCount") : total;
  }, 0);
  const scopedItems = input.items.filter(
    (item) => activeSourceIds.has(item.connectorId) && scopedSourceTargetIds.has(item.sourceTargetId),
  );
  const latestPollItems = scopedItems.filter((item) => {
    const cursor = cursorByTarget.get(item.sourceTargetId);
    const changedUrlHashes = cursorStringArrayValue(cursor, "lastChangedUrlHashes");
    return targetChangedInLatestPoll(cursor) && changedUrlHashes.has(item.urlHash);
  });
  const latestPollDisplayCount = Math.max(latestPollChangeCount, latestPollItems.length);
  const latestPollCursorChangeTimes =
    latestPollChangeCount > 0
      ? scopedSources.map((source) => cursorStringValue(cursorByTarget.get(source.id), "lastChangedAt"))
      : [];
  const recentChanges = latestPollItems
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      title: item.title,
      canonicalUrl: item.canonicalUrl,
      connectorId: item.connectorId,
      observedAt: item.observedAt,
      coverageLabel:
        scopedSources.find((source) => source.id === item.sourceTargetId)?.coverageLabel ?? null,
    }));
  const lastChangeAt = latestTimestamp([
    ...recentChanges.map((change) => change.observedAt),
    ...latestPollCursorChangeTimes,
  ]);

  const degradedSource = scopedCoverage.find((entry) => entry.status === "degraded");
  const manualOnlySource = scopedCoverage.find((entry) => entry.status === "manual_only");
  const unavailableSource = scopedCoverage.find(
    (entry) => entry.status === "unavailable" && entry.sourceId === "website",
  );
  const unpolledSources = scopedSources.filter((source) => !cursorForTarget(input.pollCursors, source.id)?.lastPolledAt);

  if (unavailableSource) {
    return {
      state: "source_unavailable",
      headline: "Website source unavailable",
      summary: unavailableSource.reasonMessage ?? "Website tracking is not available for this workspace right now.",
      proofStrength: "No active proof path",
      sourceConfidence: "Unavailable",
      nextAction: { label: unavailableSource.actionNeeded ?? "Use available sources" },
      recentChanges: [],
      sourceCoverage: scopedCoverage,
      lastPollAt,
      lastChangeAt,
    };
  }

  const neverPolled = scopedSources.every((source) => !cursorForTarget(input.pollCursors, source.id)?.lastPolledAt);

  if (manualOnlySource && scopedSources.length === 0) {
    return {
      state: "manual_proof_needed",
      headline: "Manual proof required",
      summary: manualOnlySource.reasonMessage ?? "This source requires manual proof or explicit approval.",
      proofStrength: "Manual proof only",
      sourceConfidence: "Not automated",
      nextAction: { label: manualOnlySource.actionNeeded ?? "Add manual proof" },
      recentChanges: [],
      sourceCoverage: scopedCoverage,
      lastPollAt,
      lastChangeAt,
    };
  }

  if (scopedSources.length === 0) {
    return {
      state: "not_enough_data",
      headline: "Add a website source to start",
      summary: `${input.entity.label} has no website or open-web sources yet. Add a public URL to collect proof-backed updates.`,
      proofStrength: "No proof yet",
      sourceConfidence: sourceConfidenceFromCoverage(scopedCoverage),
      nextAction: { label: "Add website source" },
      recentChanges: [],
      sourceCoverage: scopedCoverage,
      lastPollAt,
      lastChangeAt,
    };
  }

  if (degradedSource) {
    return {
      state: "degraded",
      headline: "Source check hit a limitation",
      summary:
        degradedSource.reasonMessage ??
        "The latest website poll failed or was blocked. No new proof was invented.",
      proofStrength:
        recentChanges.length > 0
          ? proofStrengthFromItems(latestPollItems, scopedSources)
          : "Stale or partial",
      sourceConfidence: sourceConfidenceFromCoverage(scopedCoverage),
      nextAction: { label: degradedSource.actionNeeded ?? "Retry source check" },
      recentChanges,
      sourceCoverage: scopedCoverage,
      lastPollAt,
      lastChangeAt,
    };
  }

  if (neverPolled || (unpolledSources.length > 0 && recentChanges.length === 0 && latestPollChangeCount === 0)) {
    const partial = !neverPolled && unpolledSources.length > 0;
    return {
      state: "queued",
      headline: partial ? "Some website sources still need a first check" : "Ready for first check",
      summary: partial
        ? `${unpolledSources.length} website source target${unpolledSources.length === 1 ? "" : "s"} for ${input.entity.label} still need a first check.`
        : `Website sources are configured for ${input.entity.label}. Run a check to fetch the latest public content.`,
      proofStrength: "Awaiting first poll",
      // Coverage-derived confidence would claim "High — verified feed"
      // before anything has ever been checked. Confidence is earned by a
      // successful check, not by configuration.
      sourceConfidence: "Not checked yet — we run the first check shortly",
      nextAction: { label: "Check website source now" },
      recentChanges: [],
      sourceCoverage: scopedCoverage,
      lastPollAt,
      lastChangeAt,
    };
  }

  // A failed or never-successful latest poll can never produce a quiet
  // claim. Without this branch, an entity whose checks have been failing
  // falls through to "All quiet" with full source confidence — an unproven
  // claim rendered as proven.
  const failingSources = scopedSources.filter((source) => {
    const cursor = cursorByTarget.get(source.id);
    if (!cursor?.lastPolledAt) return false;
    if (cursor.lastErrorCode) return true;
    if (!cursor.lastSuccessAt) return true;
    return cursor.lastPolledAt > cursor.lastSuccessAt;
  });
  if (failingSources.length > 0 && recentChanges.length === 0 && latestPollChangeCount === 0) {
    const lastSuccessAt = latestTimestamp(
      scopedSources.map((source) => cursorByTarget.get(source.id)?.lastSuccessAt ?? null),
    );
    return {
      state: "degraded",
      headline: "Latest website check failed",
      summary: lastSuccessAt
        ? "The most recent check could not read this entity's website. We keep retrying on schedule; nothing here is newer than the last successful check."
        : "No check has succeeded for this entity's website yet. We keep retrying on schedule; there is no proof-backed content to show.",
      proofStrength: lastSuccessAt ? "Stale — last check failed" : "No successful check yet",
      sourceConfidence: "Low — latest check failed",
      nextAction: { label: "Retry source check" },
      recentChanges: [],
      sourceCoverage: scopedCoverage,
      lastPollAt,
      lastChangeAt,
    };
  }

  if (recentChanges.length > 0) {
    const includesHiddenChanges = latestPollChangeCount > latestPollItems.length;
    return {
      state: "ready",
      headline: "Recent public changes worth reviewing",
      summary: includesHiddenChanges
        ? `Found ${latestPollDisplayCount} proof-backed website change${latestPollDisplayCount === 1 ? "" : "s"}, including removals or unavailable public content.`
        : `Found ${latestPollDisplayCount} proof-backed update${latestPollDisplayCount === 1 ? "" : "s"} from website sources.`,
      proofStrength: proofStrengthFromItems(latestPollItems, scopedSources),
      // One source succeeded, another is failing: confidence must say so —
      // a newer failure cannot hide behind an older success.
      sourceConfidence:
        failingSources.length > 0
          ? "Mixed — a source check is failing; we keep retrying"
          : sourceConfidenceFromCoverage(scopedCoverage),
      nextAction: { label: "Review latest changes" },
      recentChanges,
      sourceCoverage: scopedCoverage,
      lastPollAt,
      lastChangeAt,
    };
  }

  if (latestPollChangeCount > 0) {
    return {
      state: "ready",
      headline: "Website source changes worth reviewing",
      summary: `Detected ${latestPollChangeCount} proof-backed website change${latestPollChangeCount === 1 ? "" : "s"}, including removals or unavailable public content.`,
      proofStrength: "Proof-backed source change",
      sourceConfidence: sourceConfidenceFromCoverage(scopedCoverage),
      nextAction: { label: "Review source history" },
      recentChanges: [],
      sourceCoverage: scopedCoverage,
      lastPollAt,
      lastChangeAt,
    };
  }

  return {
    state: "all_quiet",
    headline: "All quiet on website sources",
    summary: `Checked ${input.entity.label}'s website sources and found no new public content since the last successful poll.`,
    proofStrength: proofStrengthFromItems([], scopedSources),
    sourceConfidence: sourceConfidenceFromCoverage(scopedCoverage),
    nextAction: { label: "Add another source or schedule digest" },
    recentChanges: [],
    sourceCoverage: scopedCoverage,
    lastPollAt,
    lastChangeAt,
  };
}
