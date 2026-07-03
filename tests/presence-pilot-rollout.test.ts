import { beforeEach, describe, expect, it, vi } from "vitest";

import { evaluateConnectorAccessGate } from "~/lib/presence-access-gates.server";
import {
  evaluatePresenceWorkspaceAccess,
  hasApprovedPilotWorkspace,
  presenceWebsiteRolloutState,
} from "~/lib/presence-internal-access.server";
import { pollPresenceSourceTarget } from "~/lib/presence-service.server";
import {
  enrollPilotWorkspace,
  hashWorkspaceId,
  isPilotWorkspaceEnrolled,
  revokePilotWorkspace,
} from "~/lib/presence-pilot-access.server";
import {
  getPollCursor,
  listActiveSourceTargetsForPolling,
  listPresenceItems,
  reconcilePresenceItemsAfterPoll,
  updateSourceTargetCoverageLabel,
  upsertPollCursor,
  upsertPresenceItems,
} from "~/lib/presence-data.server";
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
  pollCursor?: Record<string, unknown>;
  sourceTarget?: { id: string; user_id: string; coverage_label: string; metadata_json?: string };
}) {
  const pilotHashes = state.pilotHashes ?? new Set<string>();
  const items = state.items ?? [];
  let pollCursor = state.pollCursor ?? null;
  const sourceTarget = state.sourceTarget ?? {
    id: "st_1",
    user_id: "u1",
    coverage_label: "PUBLIC_WEB_BEST_EFFORT",
    metadata_json: "{}",
  };

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
          if (sql.includes("FROM presence_poll_cursor")) {
            return pollCursor as T;
          }
          if (sql.includes("FROM tracked_entity")) {
            return {
              id: "te_1",
              user_id: "u1",
              tracking_mode: "competitor",
              label: "Example",
              canonical_url: "https://example.com",
              notes: null,
              is_active: 1,
              deleted_at: null,
              created_at: "2026-07-01T00:00:00.000Z",
              updated_at: "2026-07-01T00:00:00.000Z",
            } as T;
          }
          if (sql.includes("FROM source_target")) {
            return {
              id: sourceTarget.id,
              tracked_entity_id: "te_1",
              user_id: sourceTarget.user_id,
              connector_id: "website",
              target_key: "example.com",
              target_url: "https://example.com",
              target_handle: null,
              metadata_json: sourceTarget.metadata_json ?? "{}",
              coverage_label: sourceTarget.coverage_label,
              is_active: 1,
              deleted_at: null,
              created_at: "2026-07-01T00:00:00.000Z",
              updated_at: "2026-07-01T00:00:00.000Z",
            } as T;
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
          if (sql.includes("UPDATE source_target") && sql.includes("coverage_label = ?")) {
            sourceTarget.coverage_label = String(binds[0]);
            return { meta: { changes: 1 } };
          }
          if (sql.includes("UPDATE presence_poll_cursor")) {
            pollCursor = {
              source_target_id: String(binds[8]),
              cursor_json: String(binds[0]),
              etag: binds[1],
              last_modified: binds[2],
              last_polled_at: binds[3],
              last_success_at: binds[4],
              last_error_code: binds[5],
              last_error_message: binds[6],
              updated_at: binds[7],
            };
          }
          if (sql.includes("INSERT INTO presence_poll_cursor")) {
            pollCursor = {
              source_target_id: String(binds[0]),
              cursor_json: String(binds[1]),
              etag: binds[2],
              last_modified: binds[3],
              last_polled_at: binds[4],
              last_success_at: binds[5],
              last_error_code: binds[6],
              last_error_message: binds[7],
              updated_at: binds[8],
            };
          }
          return { meta: { changes: 0 } };
        },
        async all() {
          if (sql.includes("FROM user_plan")) {
            return {
              results: [
                {
                  plan: "starter",
                  dodo_status: null,
                  dodo_next_billing_at: null,
                },
              ],
            };
          }
          if (sql.includes("SELECT url_hash FROM presence_item")) {
            const observedUrlHashes = new Set(binds.slice(1).map(String));
            return {
              results: items
                .filter((item) => !observedUrlHashes.has(item.url_hash))
                .map((item) => ({ url_hash: item.url_hash })),
            };
          }
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
    expect(stats.changedUrlHashes).toEqual([urlHash]);
    expect(items[0]?.revision).toBe(2);
  });

  it("tombstones items missing from a complete feed snapshot", async () => {
    const env = {
      ...baseEnv,
      DB: mockDb({ items: [{ id: "pitem_1", url_hash: "removed-hash", content_hash: "hash", revision: 1 }] }),
    } satisfies Partial<AppEnv> as AppEnv;
    const result = await reconcilePresenceItemsAfterPoll(env, {
      sourceTarget,
      observedUrlHashes: ["seen-hash"],
      completeSnapshot: true,
    });
    expect(result.tombstoned).toBe(1);
    expect(result.tombstonedUrlHashes).toEqual(["removed-hash"]);
  });

  it("does not mass-tombstone active items when a complete feed snapshot is empty", async () => {
    const env = { ...baseEnv, DB: mockDb({}) } satisfies Partial<AppEnv> as AppEnv;
    const result = await reconcilePresenceItemsAfterPoll(env, {
      sourceTarget,
      observedUrlHashes: [],
      completeSnapshot: true,
    });
    expect(result.tombstoned).toBe(0);
    expect(result.tombstonedUrlHashes).toEqual([]);
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

  it("clears stale poll errors on successful cursor update", async () => {
    const env = {
      ...baseEnv,
      DB: mockDb({
        pollCursor: {
          source_target_id: "st_1",
          cursor_json: "{}",
          etag: null,
          last_modified: null,
          last_polled_at: "2026-07-01T00:00:00.000Z",
          last_success_at: null,
          last_error_code: "robots_disallowed",
          last_error_message: "Robots.txt disallows this path.",
          updated_at: "2026-07-01T00:00:00.000Z",
        },
      }),
    } satisfies Partial<AppEnv> as AppEnv;

    await upsertPollCursor(env, "st_1", {
      cursor: { syncCycleCount: 2 },
      lastPolledAt: "2026-07-02T00:00:00.000Z",
      lastSuccessAt: "2026-07-02T00:00:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
    });

    const cursor = await getPollCursor(env, "st_1");
    expect(cursor?.lastErrorCode).toBeNull();
    expect(cursor?.lastErrorMessage).toBeNull();
    expect(cursor?.lastSuccessAt).toBe("2026-07-02T00:00:00.000Z");
  });

  it("persists upgraded verified feed coverage after a successful feed poll", async () => {
    const env = {
      ...baseEnv,
      DB: mockDb({
        sourceTarget: { id: "st_1", user_id: "u1", coverage_label: "PUBLIC_WEB_BEST_EFFORT" },
      }),
    } satisfies Partial<AppEnv> as AppEnv;

    const target = await updateSourceTargetCoverageLabel(env, "u1", "st_1", "VERIFIED_PUBLIC_FEED");

    expect(target?.coverageLabel).toBe("VERIFIED_PUBLIC_FEED");
  });

  it("persists tombstoned hashes in the latest poll cursor", async () => {
    const newUrl = "https://example.com/new";
    const newUrlHash = await presenceUrlHash(newUrl);
    const env = {
      ...baseEnv,
      PRESENCE_INTERNAL_WORKSPACE_ID: "u1",
      DB: mockDb({
        items: [{ id: "pitem_old", url_hash: "removed-hash", content_hash: "old-hash", revision: 1 }],
        sourceTarget: {
          id: "st_1",
          user_id: "u1",
          coverage_label: "PUBLIC_WEB_BEST_EFFORT",
          metadata_json: JSON.stringify({ feedUrl: "https://example.com/feed" }),
        },
      }),
    } satisfies Partial<AppEnv> as AppEnv;
    const rss = `<?xml version="1.0"?><rss><channel><item><title>New post</title><link>${newUrl}</link><description>Hello</description></item></channel></rss>`;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: FiveToNinePresenceBot\nAllow: /", { status: 200 });
      }
      if (url === "https://example.com/feed") {
        return new Response(rss, {
          status: 200,
          headers: { "content-type": "application/rss+xml" },
        });
      }
      return new Response("<html><head><title>Example</title></head></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    const result = await pollPresenceSourceTarget(env, "u1", "st_1", { fetchImpl: fetchImpl as typeof fetch });
    const cursor = await getPollCursor(env, "st_1");

    expect(result.reconcileStats.tombstonedUrlHashes).toEqual(["removed-hash"]);
    expect(result.target.coverageLabel).toBe("VERIFIED_PUBLIC_FEED");
    expect(cursor?.cursor.lastChangeCount).toBe(2);
    expect(cursor?.cursor.lastChangedUrlHashes).toEqual([newUrlHash, "removed-hash"]);
  });

  it("downgrades verified feed coverage after a fallback page poll", async () => {
    const env = {
      ...baseEnv,
      PRESENCE_INTERNAL_WORKSPACE_ID: "u1",
      DB: mockDb({
        sourceTarget: {
          id: "st_1",
          user_id: "u1",
          coverage_label: "VERIFIED_PUBLIC_FEED",
          metadata_json: JSON.stringify({ feedUrl: "https://example.com/feed" }),
        },
      }),
    } satisfies Partial<AppEnv> as AppEnv;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: FiveToNinePresenceBot\nAllow: /", { status: 200 });
      }
      if (url === "https://example.com/feed") {
        return new Response("<html><body>feed temporarily unavailable</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("<html><head><title>Fallback page</title></head><body>Page content</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    const result = await pollPresenceSourceTarget(env, "u1", "st_1", { fetchImpl: fetchImpl as typeof fetch });

    expect(result.target.coverageLabel).toBe("PUBLIC_WEB_BEST_EFFORT");
    expect(result.pollResult.items[0]?.title).toBe("Fallback page");
  });

  it("only lists customer-pollable website targets for batch polling", async () => {
    let preparedSql = "";
    const env = {
      ...baseEnv,
      DB: {
        prepare(sql: string) {
          preparedSql = sql;
          return {
            bind() {
              return this;
            },
            async all() {
              return { results: [] };
            },
          };
        },
      } as unknown as D1Database,
    } satisfies Partial<AppEnv> as AppEnv;

    await listActiveSourceTargetsForPolling(env, 20);
    expect(preparedSql).toContain("source_target.connector_id = 'website'");
  });

  it("supports connector-scoped presence item feeds", async () => {
    let preparedSql = "";
    let boundValues: unknown[] = [];
    const env = {
      ...baseEnv,
      DB: {
        prepare(sql: string) {
          preparedSql = sql;
          return {
            bind(...args: unknown[]) {
              boundValues = args;
              return this;
            },
            async all() {
              return { results: [] };
            },
          };
        },
      } as unknown as D1Database,
    } satisfies Partial<AppEnv> as AppEnv;

    await listPresenceItems(env, "u1", { connectorId: "website", limit: 10 });
    expect(preparedSql).toContain("INNER JOIN source_target");
    expect(preparedSql).toContain("INNER JOIN tracked_entity");
    expect(preparedSql).toContain("source_target.is_active = 1");
    expect(preparedSql).toContain("tracked_entity.is_active = 1");
    expect(preparedSql).toContain("presence_item.connector_id = ?");
    expect(boundValues).toContain("website");
  });
});

describe("presence rollout state parsing", () => {
  it("parses pilot from env", () => {
    expect(presenceWebsiteRolloutState({ ...baseEnv, PRESENCE_WEBSITE_ROLLOUT: "pilot" })).toBe("pilot");
  });
});
