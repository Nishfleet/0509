import { beforeEach, describe, expect, it, vi } from "vitest";

import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import {
  evaluatePresenceWorkspaceAccess,
  hasApprovedPilotWorkspace,
  presenceWebsiteRolloutState,
} from "~/lib/presence-internal-access.server";
import {
  enrollPilotWorkspace,
  hashWorkspaceId,
  isPilotWorkspaceEnrolled,
  revokePilotWorkspace,
} from "~/lib/presence-pilot-access.server";
import { reconcilePresenceItemsAfterPoll, upsertPresenceItems } from "~/lib/presence-data.server";
import { presenceUrlHash } from "~/lib/presence-hash";

import type { AppEnv } from "~/lib/env.server";
import type { SourceTargetRecord } from "~/lib/presence-types";

const baseEnv = {
  META_TOKEN_ENCRYPTION_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://0509.io",
  PRESENCE_WEBSITE_ROLLOUT: "internal",
  PRESENCE_INTERNAL_WORKSPACE_ID: "internal-ws",
  PRESENCE_X_ROLLOUT: "disabled",
  PRESENCE_REDDIT_ROLLOUT: "disabled",
  PRESENCE_LINKEDIN_ROLLOUT: "disabled",
} satisfies Partial<AppEnv> as AppEnv;

function mockDb(state: {
  pilotHashes?: Set<string>;
  items?: Array<{ id: string; url_hash: string; content_hash: string; revision: number }>;
}) {
  const pilotHashes = state.pilotHashes ?? new Set<string>();
  const items = state.items ?? [];

  return {
    prepare(sql: string) {
      const binds: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          binds.push(...args);
          return this;
        },
        async first<T>() {
          if (sql.includes("presence_pilot_workspace") && sql.includes("COUNT")) {
            return { count: pilotHashes.size } as T;
          }
          if (sql.includes("presence_pilot_workspace")) {
            const hash = String(binds[0]);
            return pilotHashes.has(hash) ? ({ ok: 1 } as T) : null;
          }
          if (sql.includes("FROM presence_item") && sql.includes("url_hash")) {
            const urlHash = String(binds[1]);
            const row = items.find((item) => item.url_hash === urlHash);
            return row ? ({ id: row.id, content_hash: row.content_hash, revision: row.revision } as T) : null;
          }
          return null;
        },
        async run() {
          if (sql.includes("INSERT INTO presence_pilot_workspace")) {
            pilotHashes.add(String(binds[0]));
          }
          if (sql.includes("UPDATE presence_pilot_workspace") && sql.includes("revoked_at")) {
            pilotHashes.delete(String(binds[1]));
          }
          if (sql.includes("INSERT INTO presence_item")) {
            items.push({
              id: String(binds[0]),
              url_hash: String(binds[7]),
              content_hash: String(binds[13]),
              revision: 1,
            });
          }
          if (sql.includes("UPDATE presence_item") && sql.includes("revision = ?")) {
            const id = String(binds[binds.length - 1]);
            const row = items.find((item) => item.id === id);
            if (row) {
              row.content_hash = String(binds[5]);
              row.revision = Number(binds[8]);
            }
          }
          if (sql.includes("UPDATE presence_item") && sql.includes("is_tombstone = 1")) {
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async all() {
          return { results: [] };
        },
      };
    },
  } as unknown as D1Database;
}

describe("presence pilot rollout", () => {
  it("hashes workspace ids without exposing raw values in storage keys", async () => {
    const hash = await hashWorkspaceId("workspace-abc");
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hash).not.toContain("workspace-abc");
  });

  it("gates pilot rollout to enrolled workspaces only", async () => {
    const env = {
      ...baseEnv,
      PRESENCE_WEBSITE_ROLLOUT: "pilot",
      DB: mockDb({ pilotHashes: new Set([await hashWorkspaceId("pilot-ws")]) }),
    } satisfies Partial<AppEnv> as AppEnv;

    const allowed = await evaluatePresenceWorkspaceAccess(env, "pilot-ws");
    expect(allowed.allowed).toBe(true);
    expect(allowed.rolloutState).toBe("pilot");

    const blocked = await evaluatePresenceWorkspaceAccess(env, "other-ws");
    expect(blocked.allowed).toBe(false);
    expect(blocked.reasonCode).toBe("pilot_workspace_only");
  });

  it("reports when no pilot workspaces are enrolled", async () => {
    const env = {
      ...baseEnv,
      PRESENCE_WEBSITE_ROLLOUT: "pilot",
      DB: mockDb({}),
    } satisfies Partial<AppEnv> as AppEnv;
    expect(await hasApprovedPilotWorkspace(env)).toBe(false);
  });

  it("enrolls and revokes pilot workspaces via hashed ids", async () => {
    const pilotHashes = new Set<string>();
    const env = { ...baseEnv, DB: mockDb({ pilotHashes }) } satisfies Partial<AppEnv> as AppEnv;
    await enrollPilotWorkspace(env, "pilot-ws", { invitedBy: "ops" });
    expect(await isPilotWorkspaceEnrolled(env, "pilot-ws")).toBe(true);
    await revokePilotWorkspace(env, "pilot-ws");
    expect(await isPilotWorkspaceEnrolled(env, "pilot-ws")).toBe(false);
  });

  it("blocks website connector for non-pilot workspace when rollout is pilot", async () => {
    const env = {
      ...baseEnv,
      PRESENCE_WEBSITE_ROLLOUT: "pilot",
      DB: mockDb({}),
    } satisfies Partial<AppEnv> as AppEnv;
    const gate = await evaluateConnectorAccessGate(env, "website", "competitor", "customer-ws");
    expect(gate.allowed).toBe(false);
    expect(gate.reasonCode).toBe("pilot_workspace_only");
  });
});

describe("presence sync integrity", () => {
  const sourceTarget = {
    id: "st_1",
    trackedEntityId: "te_1",
    userId: "u1",
    connectorId: "website",
    targetKey: "example.com",
  } as SourceTargetRecord;

  it("increments revision when content hash changes", async () => {
    const canonicalUrl = "https://example.com/post";
    const urlHash = await presenceUrlHash(canonicalUrl);
    const items = [
      { id: "pitem_1", url_hash: urlHash, content_hash: "old-hash", revision: 1 },
    ];
    const env = { ...baseEnv, DB: mockDb({ items }) } satisfies Partial<AppEnv> as AppEnv;
    const stats = await upsertPresenceItems(env, {
      sourceTarget,
      items: [
        {
          externalId: null,
          canonicalUrl,
          title: "Updated title",
          bodyExcerpt: "Body",
          author: null,
          publishedAt: null,
          observedAt: new Date().toISOString(),
          contentHash: "new-hash",
        },
      ],
    });
    expect(stats.updated).toBe(1);
    expect(items[0]?.revision).toBe(2);
  });

  it("tombstones items missing from a complete feed snapshot", async () => {
    const env = { ...baseEnv, DB: mockDb({}) } satisfies Partial<AppEnv> as AppEnv;
    const result = await reconcilePresenceItemsAfterPoll(env, {
      sourceTarget,
      observedUrlHashes: ["seen-hash"],
      completeSnapshot: true,
    });
    expect(result.tombstoned).toBe(1);
  });

  it("skips reconciliation for partial snapshots", async () => {
    const env = { ...baseEnv, DB: mockDb({}) } satisfies Partial<AppEnv> as AppEnv;
    const result = await reconcilePresenceItemsAfterPoll(env, {
      sourceTarget,
      observedUrlHashes: [],
      completeSnapshot: false,
    });
    expect(result.tombstoned).toBe(0);
  });
});

describe("presence rollout state parsing", () => {
  it("parses pilot from env", () => {
    expect(presenceWebsiteRolloutState({ ...baseEnv, PRESENCE_WEBSITE_ROLLOUT: "pilot" })).toBe("pilot");
  });
});
