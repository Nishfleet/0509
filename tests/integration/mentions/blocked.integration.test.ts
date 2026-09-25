import { env } from "cloudflare:test";
import { NonRetryableError } from "cloudflare:workflows";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CanarySource } from "../../../app/lib/data/source.server";
import { runCanary } from "../../../workers/mentions/canary";
import { planTargets, sweepTarget } from "../../../workers/mentions/sweep";

const NOW = "2026-09-24T03:00:00.000Z";

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

async function gdeltTargetFor(brand: string) {
  const targets = await planTargets();
  const target = targets.find((entry) => entry.pluginKey === "gdelt.doc" && entry.query === brand);
  if (target === undefined) throw new Error(`no gdelt target for ${brand}`);
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
  it("case A: HTTP 202 degrades the source, and the sweep step rejects without retrying", async () => {
    const { sourceId, brand } = await seedBlockedSource("a", { enabled: true });
    const fetchMock = vi.fn(async () => new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const target = await gdeltTargetFor(brand);

      await expect(sweepTarget(target, NOW, null)).rejects.toThrow(NonRetryableError);

      expect(await readReason(sourceId)).toBe("blocked: HTTP 202");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
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
      const target = await gdeltTargetFor(brand);
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
});
