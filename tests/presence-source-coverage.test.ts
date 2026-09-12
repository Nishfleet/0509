import { describe, expect, it } from "vitest";

import {
  applyEntitySourceTargetCoverage,
  applyEntitySourceTargetsCoverage,
  applyPresenceSourcePlanGates,
  evaluatePresenceSourceCoverage,
  listPresenceSourceCoverage,
  presenceSourceCoverageForDocs,
} from "~/lib/presence-source-coverage.server";
import { SOURCES } from "~/lib/sources/registry.server";
import type { AppEnv } from "~/lib/env.server";
import type { PresencePollCursorRecord, SourceTargetRecord } from "~/lib/presence-types";

const baseEnv = {
  META_TOKEN_ENCRYPTION_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://0509.io",
  PRESENCE_WEBSITE_ROLLOUT: "generally_available",
  PRESENCE_X_ROLLOUT: "disabled",
  PRESENCE_REDDIT_ROLLOUT: "disabled",
  PRESENCE_LINKEDIN_ROLLOUT: "disabled",
} satisfies Partial<AppEnv> as AppEnv;

function sourceTarget(overrides: Partial<SourceTargetRecord> = {}): SourceTargetRecord {
  return {
    id: overrides.id ?? "target-1",
    trackedEntityId: overrides.trackedEntityId ?? "entity-1",
    userId: overrides.userId ?? "user-1",
    connectorId: overrides.connectorId ?? "website",
    targetKey: overrides.targetKey ?? "example.com",
    targetUrl: overrides.targetUrl ?? "https://example.com",
    targetHandle: overrides.targetHandle ?? null,
    metadata: overrides.metadata ?? {},
    coverageLabel: overrides.coverageLabel ?? "PUBLIC_WEB_BEST_EFFORT",
    isActive: overrides.isActive ?? true,
    deletedAt: overrides.deletedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-07-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-01T00:00:00.000Z",
  };
}

function pollCursor(overrides: Partial<PresencePollCursorRecord> = {}): PresencePollCursorRecord {
  return {
    sourceTargetId: overrides.sourceTargetId ?? "target-1",
    cursor: overrides.cursor ?? {},
    etag: overrides.etag ?? null,
    lastModified: overrides.lastModified ?? null,
    lastPolledAt: overrides.lastPolledAt ?? null,
    lastSuccessAt: overrides.lastSuccessAt ?? null,
    lastErrorCode: overrides.lastErrorCode ?? null,
    lastErrorMessage: overrides.lastErrorMessage ?? null,
    updatedAt: overrides.updatedAt ?? "2026-07-01T00:00:00.000Z",
  };
}

describe("presence source coverage policy", () => {
  it("marks website as available when GA rollout is enabled", async () => {
    const entry = await evaluatePresenceSourceCoverage(baseEnv, "website", "competitor");
    expect(entry.status).toBe("available");
    expect(entry.coverageLabel).toBe("PUBLIC_WEB_BEST_EFFORT");
  });

  it("marks an allowed internal website rollout as available for that workspace", async () => {
    const entry = await evaluatePresenceSourceCoverage(
      {
        ...baseEnv,
        PRESENCE_WEBSITE_ROLLOUT: "internal",
        PRESENCE_INTERNAL_WORKSPACE_ID: "user-1",
      },
      "website",
      "competitor",
      "user-1",
    );
    expect(entry.status).toBe("available");
    expect(entry.actionNeeded).toBe("Add a source target");
  });

  it("marks X as unavailable when rollout is disabled", async () => {
    const entry = await evaluatePresenceSourceCoverage(baseEnv, "x", "competitor");
    expect(entry.status).toBe("unavailable");
    expect(entry.reasonCode).toBe("connector_disabled");
  });

  it("marks Reddit as gated without commercial access approval", async () => {
    const entry = await evaluatePresenceSourceCoverage(
      {
        ...baseEnv,
        PRESENCE_REDDIT_ROLLOUT: "internal",
        REDDIT_CLIENT_ID: "id",
        REDDIT_CLIENT_SECRET: "secret",
      },
      "reddit",
      "competitor",
    );
    expect(entry.status).toBe("gated");
    expect(entry.reasonCode).toBe("commercial_access_pending");
  });

  it("marks LinkedIn competitor tracking as limited", async () => {
    const entry = await evaluatePresenceSourceCoverage(
      {
        ...baseEnv,
        PRESENCE_LINKEDIN_ROLLOUT: "internal",
        LINKEDIN_CLIENT_ID: "id",
        LINKEDIN_CLIENT_SECRET: "secret",
      },
      "linkedin",
      "competitor",
    );
    expect(entry.status).toBe("limited");
    expect(entry.coverageLabel).toBe("LIMITED_COVERAGE");
  });

  it("marks YouTube as planned without claiming active coverage", async () => {
    const entry = await evaluatePresenceSourceCoverage(baseEnv, "youtube", "competitor");
    expect(entry.status).toBe("planned");
    expect(entry.reasonCode).toBe("api_not_configured");
  });

  it("marks Amazon as manual-only", async () => {
    const entry = await evaluatePresenceSourceCoverage(baseEnv, "amazon", "competitor");
    expect(entry.status).toBe("manual_only");
    expect(entry.reasonCode).toBe("manual_proof_required");
  });

  it("marks Context.dev as planned when not configured", async () => {
    const entry = await evaluatePresenceSourceCoverage(baseEnv, "context_dev", "competitor");
    expect(entry.status).toBe("planned");
    expect(entry.reasonCode).toBe("provider_not_configured");
  });

  it("lists all catalog sources without hand-rolled drift", async () => {
    const entries = await listPresenceSourceCoverage(baseEnv, "competitor");
    expect(entries.map((entry) => entry.sourceId)).toEqual([
      "website",
      "x",
      "reddit",
      "linkedin",
      "rss",
      "gdelt",
      "youtube",
      "amazon",
      "context_dev",
      "google",
      "google_ads",
      "tiktok",
      "subdomains",
      "hiring",
    ]);
  });

  it("overrides coverage when the current plan does not allow a mode", async () => {
    const entries = await listPresenceSourceCoverage(baseEnv, "self");
    const gated = applyPresenceSourcePlanGates(entries, {
      modeAllowed: false,
      websiteSourcesAllowed: true,
      socialConnectAllowed: true,
    });
    expect(gated.find((entry) => entry.sourceId === "website")?.status).toBe("unavailable");
    expect(gated.find((entry) => entry.sourceId === "website")?.reasonCode).toBe("mode_not_in_plan");
  });

  it("overrides available social connector coverage when social sources are not on the plan", () => {
    const gated = applyPresenceSourcePlanGates(
      [
        {
          sourceId: "x",
          label: "X",
          status: "available",
          coverageLabel: "OFFICIAL_PUBLIC_API",
          reasonCode: null,
          reasonMessage: null,
          actionNeeded: "Add a source target",
          connectorId: "x",
        },
      ],
      {
        modeAllowed: true,
        websiteSourcesAllowed: true,
        socialConnectAllowed: false,
      },
    );
    expect(gated.find((entry) => entry.sourceId === "x")?.status).toBe("gated");
    expect(gated.find((entry) => entry.sourceId === "x")?.reasonCode).toBe("social_connect_not_in_plan");
  });

  it("marks x as available when rollout, creds and paid-read approval are enabled", async () => {
    const entry = await evaluatePresenceSourceCoverage(
      {
        ...baseEnv,
        PRESENCE_X_ROLLOUT: "ga",
        X_API_BEARER_TOKEN: "token",
        PRESENCE_X_MOCK: "1",
        X_PAID_ACCESS: "approved",
      },
      "x",
      "competitor",
    );
    expect(entry.status).toBe("available");
  });

  it("keeps x gated as a paid source until the spend decision lands", async () => {
    const entry = await evaluatePresenceSourceCoverage(
      {
        ...baseEnv,
        PRESENCE_X_ROLLOUT: "ga",
        X_API_BEARER_TOKEN: "token",
      },
      "x",
      "competitor",
    );
    expect(entry.status).toBe("gated");
    expect(entry.reasonCode).toBe("paid_source_pending_nish");
    expect(entry.coverageLabel).toBe("UNAVAILABLE");
  });

  it("preserves provider-disabled truth before social plan gates", async () => {
    const entries = await listPresenceSourceCoverage(baseEnv, "competitor");
    const gated = applyPresenceSourcePlanGates(entries, {
      modeAllowed: true,
      websiteSourcesAllowed: true,
      socialConnectAllowed: false,
    });
    expect(gated.find((entry) => entry.sourceId === "x")?.status).toBe("unavailable");
    expect(gated.find((entry) => entry.sourceId === "x")?.reasonCode).toBe("connector_disabled");
  });

  it("marks entity website target as connected after poll", async () => {
    const policy = await evaluatePresenceSourceCoverage(baseEnv, "website", "competitor");
    const applied = applyEntitySourceTargetCoverage(
      policy,
      sourceTarget(),
      pollCursor({ lastPolledAt: "2026-07-02T00:00:00.000Z", lastSuccessAt: "2026-07-02T00:00:00.000Z" }),
    );
    expect(applied.status).toBe("connected");
  });

  it("surfaces persisted verified-feed coverage for polled website targets", async () => {
    const policy = await evaluatePresenceSourceCoverage(baseEnv, "website", "competitor");
    const applied = applyEntitySourceTargetCoverage(
      policy,
      sourceTarget({ coverageLabel: "VERIFIED_PUBLIC_FEED" }),
      pollCursor({ lastPolledAt: "2026-07-02T00:00:00.000Z", lastSuccessAt: "2026-07-02T00:00:00.000Z" }),
    );
    expect(applied.status).toBe("connected");
    expect(applied.coverageLabel).toBe("VERIFIED_PUBLIC_FEED");
  });

  it("marks entity website target as degraded on poll failure", async () => {
    const policy = await evaluatePresenceSourceCoverage(baseEnv, "website", "competitor");
    const applied = applyEntitySourceTargetCoverage(
      policy,
      sourceTarget(),
      pollCursor({
        lastPolledAt: "2026-07-02T00:00:00.000Z",
        lastErrorCode: "robots_disallowed",
        lastErrorMessage: "Robots.txt disallows this path.",
      }),
    );
    expect(applied.status).toBe("degraded");
    expect(applied.reasonCode).toBe("robots_disallowed");
  });

  it("does not mark a disabled source target as connected", async () => {
    const policy = await evaluatePresenceSourceCoverage(baseEnv, "x", "competitor");
    const applied = applyEntitySourceTargetCoverage(
      policy,
      sourceTarget({ connectorId: "x", coverageLabel: "OFFICIAL_PUBLIC_API" }),
      pollCursor({ lastPolledAt: "2026-07-02T00:00:00.000Z", lastSuccessAt: "2026-07-02T00:00:00.000Z" }),
    );
    expect(applied.status).toBe("unavailable");
    expect(applied.reasonCode).toBe("connector_disabled");
  });

  it("does not mark an inactive source target as connected", async () => {
    const policy = await evaluatePresenceSourceCoverage(baseEnv, "website", "competitor");
    const applied = applyEntitySourceTargetCoverage(
      policy,
      sourceTarget({ isActive: false }),
      pollCursor({ lastPolledAt: "2026-07-02T00:00:00.000Z", lastSuccessAt: "2026-07-02T00:00:00.000Z" }),
    );
    expect(applied.status).toBe("available");
    expect(applied.actionNeeded).toBe("Add a source target");
  });

  it("marks aggregate coverage as degraded when any target has a poll error", async () => {
    const policy = await evaluatePresenceSourceCoverage(baseEnv, "website", "competitor");
    const applied = applyEntitySourceTargetsCoverage(
      policy,
      [sourceTarget({ id: "target-1" }), sourceTarget({ id: "target-2", targetKey: "example.com/pricing" })],
      [
        {
          sourceTargetId: "target-1",
          cursor: pollCursor({
            sourceTargetId: "target-1",
            lastPolledAt: "2026-07-02T00:00:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
          }),
        },
        {
          sourceTargetId: "target-2",
          cursor: pollCursor({
            sourceTargetId: "target-2",
            lastPolledAt: "2026-07-02T00:05:00.000Z",
            lastErrorCode: "robots_disallowed",
            lastErrorMessage: "Robots.txt disallows this path.",
          }),
        },
      ],
    );
    expect(applied.status).toBe("degraded");
    expect(applied.reasonCode).toBe("robots_disallowed");
  });

  it("keeps connected aggregate coverage actionable when any target was never polled", async () => {
    const policy = await evaluatePresenceSourceCoverage(baseEnv, "website", "competitor");
    const applied = applyEntitySourceTargetsCoverage(
      policy,
      [sourceTarget({ id: "target-1" }), sourceTarget({ id: "target-2", targetKey: "example.com/pricing" })],
      [
        {
          sourceTargetId: "target-1",
          cursor: pollCursor({
            sourceTargetId: "target-1",
            lastPolledAt: "2026-07-02T00:00:00.000Z",
            lastSuccessAt: "2026-07-02T00:00:00.000Z",
          }),
        },
      ],
    );
    expect(applied.status).toBe("connected");
    expect(applied.actionNeeded).toBe("Run first check for 1 source target");
  });

  it("keeps docs coverage table honest about production status", () => {
    const docs = presenceSourceCoverageForDocs();
    expect(docs.find((entry) => entry.sourceId === "website")?.productionStatus).toBe("active");
    expect(docs.find((entry) => entry.sourceId === "youtube")?.productionStatus).toBe("planned");
    expect(docs.find((entry) => entry.sourceId === "amazon")?.productionStatus).toBe("manual_only");
    expect(docs.find((entry) => entry.sourceId === "x")?.productionStatus).toBe("gated");
  });

  // The five seam competitor-monitoring sources (#2218) report "configured"
  // only once their adapter exports implemented: true AND requiresEnv(env) is
  // true (the coverage policy mirrors that exactly). Everything else — a stub
  // (implemented: false) or an implemented adapter whose credentials are
  // absent — reports "coming_soon". Derive both sets from the registry so
  // this stays correct as parallel source tickets (#2181/#2189/#2194/#2198/
  // #2199) land one at a time.
  const seamIds = (["google", "google_ads", "tiktok", "subdomains", "hiring"] as const).filter(
    (id) => SOURCES.some((a) => a.id === id),
  );
  const configuredSeamIds = seamIds.filter((id) => {
    const adapter = SOURCES.find((a) => a.id === id);
    return Boolean(adapter?.implemented && adapter?.requiresEnv(baseEnv));
  });
  const comingSoonSeamIds = seamIds.filter((id) => !configuredSeamIds.includes(id));

  it("marks every configured seam source as configured", async () => {
    // #2198 implements subdomains (implemented: true, requiresEnv: () => true).
    for (const sourceId of configuredSeamIds) {
      const entry = await evaluatePresenceSourceCoverage(baseEnv, sourceId, "competitor");
      expect(entry.status, sourceId).toBe("configured");
      expect(entry.coverageLabel, sourceId).toBe("OFFICIAL_PUBLIC_API");
    }
  });

  it("marks every not-yet-configured seam source as coming_soon", async () => {
    for (const sourceId of comingSoonSeamIds) {
      const entry = await evaluatePresenceSourceCoverage(baseEnv, sourceId, "competitor");
      expect(entry.status, sourceId).toBe("coming_soon");
      expect(entry.reasonCode, sourceId).toBe("not_implemented");
      expect(entry.coverageLabel, sourceId).toBe("UNAVAILABLE");
    }
  });

  it("lists every not-yet-configured seam source in the docs coverage table as coming_soon", () => {
    const docs = presenceSourceCoverageForDocs();
    for (const sourceId of comingSoonSeamIds) {
      const entry = docs.find((d) => d.sourceId === sourceId);
      expect(entry, sourceId).toBeDefined();
      expect(entry?.productionStatus, sourceId).toBe("coming_soon");
    }
  });
});
