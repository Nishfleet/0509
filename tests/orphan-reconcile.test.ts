import { describe, expect, it, vi } from "vitest";

import {
  reconcileOrphanedArtifacts,
  runRetentionSweep,
} from "~/lib/retention.server";

const OLD_HTML = "landing-pages/2026-01-01/0123456789abcdef0123456789abcdef.html";
const OLD_SCREENSHOT = "landing-pages/2026-01-01/fedcba9876543210fedcba9876543210.jpeg";
const YOUNG_HTML = "landing-pages/2026-09-01/0123456789abcdef0123456789abcdef.html";
const BACKUP_KEY = "backups/d1/2026-01-01/0123456789abcdef0123456789abcdef.html";

const NOW = new Date("2026-09-07T12:00:00.000Z").getTime();

type ListResult = {
  objects: Array<{ key: string }>;
  truncated: boolean;
  cursor?: string;
};

function makeEnv(options: {
  list: ListResult;
  referencedKeys?: Set<string>;
  cursorRow?: { cursor_value: string | null } | null;
  enabled?: boolean;
}) {
  const deletes: string[] = [];
  const cursorWrites: Array<string | null> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return {
            async all() {
              if (sql.includes("FROM retention_sweep_state")) {
                return { results: options.cursorRow ? [options.cursorRow] : [] };
              }
              if (sql.includes("AS external_references")) {
                const key = bindings[0] as string;
                return { results: [{ external_references: options.referencedKeys?.has(key) ? 1 : 0 }] };
              }
              throw new Error(`unexpected all: ${sql}`);
            },
            async run() {
              if (sql.includes("INSERT INTO retention_sweep_state")) {
                cursorWrites.push(bindings[1] as string | null);
                return { meta: { changes: 1 } };
              }
              throw new Error(`unexpected run: ${sql}`);
            },
          };
        },
      };
    },
  };
  const bucket = {
    async list(opts: { prefix?: string; cursor?: string; limit?: number }) {
      return options.list;
    },
    async delete(key: string) {
      deletes.push(key);
    },
  };
  const env = {
    DB: db as unknown as D1Database,
    LANDING_PAGE_ARTIFACTS: bucket as unknown as R2Bucket,
  } as never;
  if (options.enabled) {
    (env as Record<string, unknown>).R2_ORPHAN_RECONCILE_ENABLED = "1";
  }
  return { env, deletes, cursorWrites };
}

describe("reconcileOrphanedArtifacts", () => {
  it("deletes an orphan outside the grace window and persists the cursor", async () => {
    const { env, deletes, cursorWrites } = makeEnv({
      list: { objects: [{ key: OLD_HTML }], truncated: true, cursor: "next-cursor" },
      enabled: true,
    });

    const result = await reconcileOrphanedArtifacts(env, { now: NOW });

    expect(result.deleted).toBe(1);
    expect(result.dryRunDeletes).toBe(0);
    expect(result.dryRun).toBe(false);
    expect(result.truncated).toBe(true);
    expect(deletes).toEqual([OLD_HTML]);
    expect(cursorWrites).toEqual(["next-cursor"]);
  });

  it("keeps a referenced key even when it is old", async () => {
    const { env, deletes } = makeEnv({
      list: { objects: [{ key: OLD_HTML }], truncated: false },
      referencedKeys: new Set([OLD_HTML]),
      enabled: true,
    });

    const result = await reconcileOrphanedArtifacts(env, { now: NOW });

    expect(result.referenced).toBe(1);
    expect(result.deleted).toBe(0);
    expect(deletes).toEqual([]);
  });

  it("keeps a shared key (referenced by more than one row)", async () => {
    const { env, deletes } = makeEnv({
      list: { objects: [{ key: OLD_SCREENSHOT }], truncated: false },
      referencedKeys: new Set([OLD_SCREENSHOT]),
      enabled: true,
    });

    const result = await reconcileOrphanedArtifacts(env, { now: NOW });

    expect(result.referenced).toBe(1);
    expect(result.deleted).toBe(0);
    expect(deletes).toEqual([]);
  });

  it("keeps an orphan inside the grace window", async () => {
    const { env, deletes } = makeEnv({
      list: { objects: [{ key: YOUNG_HTML }], truncated: false },
      enabled: true,
    });

    const result = await reconcileOrphanedArtifacts(env, { now: NOW });

    expect(result.tooYoung).toBe(1);
    expect(result.deleted).toBe(0);
    expect(deletes).toEqual([]);
  });

  it("never touches a non-matching key such as backups/d1/", async () => {
    const { env, deletes } = makeEnv({
      list: { objects: [{ key: BACKUP_KEY }], truncated: false },
      enabled: true,
    });

    const result = await reconcileOrphanedArtifacts(env, { now: NOW });

    expect(result.nonMatching).toBe(1);
    expect(result.deleted).toBe(0);
    expect(deletes).toEqual([]);
  });

  it("resumes from a persisted cursor", async () => {
    const { env, deletes, cursorWrites } = makeEnv({
      list: { objects: [{ key: OLD_HTML }], truncated: false },
      cursorRow: { cursor_value: "saved-cursor" },
      enabled: true,
    });

    const result = await reconcileOrphanedArtifacts(env, { now: NOW });

    expect(result.deleted).toBe(1);
    expect(deletes).toEqual([OLD_HTML]);
    // Not truncated -> cursor reset to null so the next sweep starts fresh.
    expect(cursorWrites).toEqual([null]);
  });

  it("caps deletes at the per-tick budget", async () => {
    const keys = Array.from({ length: 250 }, (_, i) =>
      `landing-pages/2026-01-01/${String(i).padStart(32, "0")}.html`,
    );
    const { env, deletes } = makeEnv({
      list: { objects: keys.map((key) => ({ key })), truncated: true, cursor: "c" },
      enabled: true,
    });

    const result = await reconcileOrphanedArtifacts(env, { now: NOW });

    expect(result.deleted).toBe(200);
    expect(deletes.length).toBe(200);
  });

  it("reports counts without deleting in dry-run mode and does not advance the cursor", async () => {
    const { env, deletes, cursorWrites } = makeEnv({
      list: { objects: [{ key: OLD_HTML }], truncated: true, cursor: "next-cursor" },
      // enabled not set -> dry-run
    });

    const result = await reconcileOrphanedArtifacts(env, { now: NOW });

    expect(result.dryRun).toBe(true);
    expect(result.dryRunDeletes).toBe(1);
    expect(result.deleted).toBe(0);
    expect(deletes).toEqual([]);
    expect(cursorWrites).toEqual([]);
  });

  it("is wired into the retention sweep and reports its outcome", async () => {
    const { env } = makeEnv({
      list: { objects: [{ key: OLD_HTML }], truncated: false },
      enabled: true,
    });

    const result = await runRetentionSweep(env, { now: new Date(NOW) });

    expect(result.orphanReconcile?.deleted).toBe(1);
    expect(result.deleted.r2_orphan_reconcile).toBe(1);
  });
});
