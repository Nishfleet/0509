import { describe, expect, it } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import {
  pollPresenceTarget,
  validatePresenceTarget,
} from "~/lib/presence-connector-registry.server";
import { formatCoverageLabel } from "~/lib/presence-display";
import {
  isPresenceConnectorId,
  PRESENCE_CONNECTOR_IDS,
  type PresenceConnectorId,
  type SourceTargetRecord,
} from "~/lib/presence-types";

const PODCAST = "podcast" as PresenceConnectorId;

const env = {
  META_TOKEN_ENCRYPTION_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://0509.io",
} satisfies Partial<AppEnv> as AppEnv;

function podcastTarget(): SourceTargetRecord {
  return {
    id: "st_podcast",
    trackedEntityId: "te_1",
    userId: "user_1",
    connectorId: PODCAST,
    targetKey: "https://show.example/feed.xml",
    targetUrl: "https://show.example/feed.xml",
    targetHandle: null,
    metadata: {},
    coverageLabel: "VERIFIED_PUBLIC_FEED",
    isActive: true,
    deletedAt: null,
    createdAt: "2026-09-13T22:40:00.000Z",
    updatedAt: "2026-09-13T22:40:00.000Z",
  };
}

describe("leftover connector_id='podcast' after the #3434 window (issue #3447)", () => {
  it("keeps podcast out of the live code union", () => {
    expect(PRESENCE_CONNECTOR_IDS.includes(PODCAST)).toBe(false);
    expect(isPresenceConnectorId("podcast")).toBe(false);
    expect(isPresenceConnectorId("youtube")).toBe(true);
  });

  it("formats the leftover id without throwing", () => {
    expect(formatCoverageLabel("podcast")).toBe("podcast");
  });

  it("refuses poll dispatch instead of falling through to another connector", async () => {
    const result = await pollPresenceTarget(env, podcastTarget(), { trackingMode: "self" });
    expect(result.ok).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.errorCode).toBe("unknown_connector");
  });

  it("refuses target validation for the leftover id", async () => {
    const result = await validatePresenceTarget(
      env,
      PODCAST,
      { trackingMode: "self", targetUrl: "https://show.example/feed.xml" },
      { userId: "user_1", trackingMode: "self", connection: null },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("unknown_connector");
    expect(result.coverageLabel).toBe("UNAVAILABLE");
  });
});
