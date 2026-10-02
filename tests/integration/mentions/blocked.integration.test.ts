import { env } from "cloudflare:test";
import { NonRetryableError } from "cloudflare:workflows";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CanarySource } from "../../../app/lib/data/source.server";
import { runCanary } from "../../../workers/mentions/canary";
import { planTargets, sweepTarget } from "../../../workers/mentions/sweep";
import { BLOCKING_STATUSES } from "../../../workers/sources/mentions/types";

const NOW = "2026-09-24T03:00:00.000Z";

const ONE_ARTICLE = {
  articles: [
    {
      url: "https://news.example.com/blockedwear-opens-a-store",
      title: "Blockedwear opens a store",
      seendate: "20260923T101500Z",
      domain: "news.example.com",
    },
  ],
};

let runs = 0;

// A mentions source row plus the workspace and competitor rows
// sweep.integration.test.ts seeds. The platform is dedicated per suite so the
// UNIQUE (platform, kind, plugin_key) constraint on source cannot collide with
// the rows migrations/0001 and 0017 already insert, and so asserting on
// degraded_reason never reads a row another test wrote.
async function seedBlockedSource(
  slot: string,
  options: { readonly enabled: boolean },
): Promise<{ sourceId: string; workspaceId: string; competitorId: string; brand: string }> {
  runs += 1;
  const workspaceId = `ws-blocked-${String(runs)}`;
  const userId = `user-blocked-${String(runs)}`;
  const brand = `Blockedwear ${String(runs)}`;
  const competitorId = `${workspaceId}-competitor`;
  const sourceId = `src_blocked_${slot}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, `${userId}@example.com`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'self', ?3, 'Gymshark', '{\"description\":\"Gym clothing\"}', ?4)",
    ).bind(`${workspaceId}-self`, workspaceId, `gymshark-${String(runs)}.com`, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, ?5)",
    ).bind(competitorId, workspaceId, `blockedwear-${String(runs)}.com`, brand, NOW),
    env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json, canary_query)
       VALUES (?1, ?2, 'mentions', ?3, 'gdelt.doc', 'official_api', ?4, '{}', 'google')`,
    ).bind(sourceId, `blocked.test.${slot}`, `blocked_${slot}`, options.enabled ? 1 : 0),
  ]);
  return { sourceId, workspaceId, competitorId, brand };
}

// planTargets() groups by (source_id, target_key), and migrations/0017 already
// ships an enabled gdelt.doc row. Matching on sourceId as well as the brand is
// what pins the assertion to the row this test seeded.
async function gdeltTargetFor(sourceId: string, brand: string) {
  const targets = await planTargets();
  const target = targets.find(
    (entry) => entry.sourceId === sourceId && entry.pluginKey === "gdelt.doc" && entry.query === brand,
  );
  if (target === undefined) throw new Error(`no gdelt target for ${brand} on ${sourceId}`);
  return target;
}

async function readReason(sourceId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT degraded_reason FROM source WHERE id = ?")
    .bind(sourceId)
    .first<{ degraded_reason: string | null }>();
  return row?.degraded_reason ?? null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a blocking upstream degrades the source and ends the step (0509#5159)", () => {
  it("the block set is exactly 202, 403 and 429", () => {
    expect([...BLOCKING_STATUSES].sort((a, b) => a - b)).toEqual([202, 403, 429]);
  });

  it("case A: HTTP 202 degrades the source and the sweep returns a skipped outcome (0509#6592)", async () => {
    const { sourceId, brand } = await seedBlockedSource("a", { enabled: true });
    const fetchMock = vi.fn(async () => new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const target = await gdeltTargetFor(sourceId, brand);
      expect(target.watches.length).toBeGreaterThan(0);

      const outcome = await sweepTarget(target, NOW, null);

      expect(outcome).toEqual({
        items: 0,
        stored: 0,
        unjudged: 0,
        skipped: target.watches.length,
      });
      expect(await readReason(sourceId)).toBe("blocked: HTTP 202");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await env.DB.prepare("DELETE FROM source WHERE id = ?").bind(sourceId).run();
    }
  });

  it("case F: HTTP 429 in a sweep skips the watches, logs once and leaves degraded_reason NULL (0509#6612)", async () => {
    const { sourceId, brand } = await seedBlockedSource("f", { enabled: true });
    const fetchMock = vi.fn(async () => new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const target = await gdeltTargetFor(sourceId, brand);

      const outcome = await sweepTarget(target, NOW, null);

      expect(outcome).toEqual({ items: 0, stored: 0, unjudged: 0, skipped: target.watches.length });
      expect(await readReason(sourceId)).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
        event: "mentions.rate_limited",
        source: "gdelt.doc",
        status: 429,
      });
    } finally {
      warn.mockRestore();
      await env.DB.prepare("DELETE FROM source WHERE id = ?").bind(sourceId).run();
    }
  });

  it("case B: HTTP 429 degrades the source and the canary returns zero without overwriting the reason", async () => {
    const { sourceId } = await seedBlockedSource("b", { enabled: false });
    const source: CanarySource = { id: sourceId, pluginKey: "gdelt.doc", canaryQuery: "google" };
    const fetchMock = vi.fn(async () => new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const count = await runCanary(source, NOW);

      expect(count).toBe(0);
      expect(await readReason(sourceId)).toBe("blocked: HTTP 429");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await env.DB.prepare("DELETE FROM source WHERE id = ?").bind(sourceId).run();
    }
  });

  it("case C: HTTP 500 is a plain retryable error and leaves degraded_reason alone", async () => {
    const { sourceId, brand } = await seedBlockedSource("c", { enabled: true });
    const fetchMock = vi.fn(async () => new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const target = await gdeltTargetFor(sourceId, brand);
      const error = await sweepTarget(target, NOW, null).then(
        () => null,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(NonRetryableError);
      expect(await readReason(sourceId)).toBeNull();
    } finally {
      await env.DB.prepare("DELETE FROM source WHERE id = ?").bind(sourceId).run();
    }
  });

  it("case E: an upstream timeout retries once, then the step returns a partial result naming the skipped watches (0509#5106, 0509#6079, 0509#6080)", async () => {
    const { sourceId, brand } = await seedBlockedSource("e", { enabled: true });
    const timeoutError = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const fetchMock = vi.fn(async () => {
      throw timeoutError;
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const target = await gdeltTargetFor(sourceId, brand);
      expect(target.watches.length).toBeGreaterThan(0);

      const outcome = await sweepTarget(target, NOW, null);

      expect(outcome).toEqual({
        items: 0,
        stored: 0,
        unjudged: 0,
        skipped: target.watches.length,
      });
      expect(await readReason(sourceId)).toBe("timed out");
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const snapshots = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM snapshot sn JOIN watch w ON w.id = sn.watch_id WHERE w.source_id = ?",
      )
        .bind(sourceId)
        .first<{ n: number }>();
      expect(snapshots?.n).toBe(0);
      const polled = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM watch WHERE source_id = ? AND last_polled_at IS NOT NULL",
      )
        .bind(sourceId)
        .first<{ n: number }>();
      expect(polled?.n).toBe(0);
    } finally {
      await env.DB.prepare("DELETE FROM source WHERE id = ?").bind(sourceId).run();
    }
  });

  it("case D: a later good canary clears the blocked reason", async () => {
    const { sourceId } = await seedBlockedSource("d", { enabled: false });
    const source: CanarySource = { id: sourceId, pluginKey: "gdelt.doc", canaryQuery: "google" };

    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("", { status: 403 })),
      );
      expect(await runCanary(source, NOW)).toBe(0);
      expect(await readReason(sourceId)).toBe("blocked: HTTP 403");

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(ONE_ARTICLE))),
      );
      expect(await runCanary(source, NOW)).toBe(1);
      expect(await readReason(sourceId)).toBeNull();
    } finally {
      await env.DB.prepare("DELETE FROM source WHERE id = ?").bind(sourceId).run();
    }
  });
});
