import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { readSignalCounts } from "../../../app/lib/data/signal.server";
import { readLatestPeers } from "../../../app/lib/data/standing.server";

const NOW = "2026-09-24T12:00:00.000Z";
const WEEK_OLD = "2026-09-07T12:00:00.000Z";
const WEEK_LATEST = "2026-09-14T12:00:00.000Z";
const WEEK_UNFROZEN = "2026-09-21T12:00:00.000Z";
const SINCE = "2026-08-25T12:00:00.000Z";

interface Seed {
  user: string;
  wsA: string;
  wsB: string;
  selfA: string;
  compOn: string;
  compOff: string;
  compB: string;
  source: string;
}

let runs = 0;
let seed: Seed;

function standingRow(
  id: string,
  workspaceId: string,
  entityId: string,
  weekStart: string,
  rank: number | null,
): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, movement, computed_at) VALUES (?1, ?2, ?3, ?4, 0, ?5, NULL, ?6)",
  ).bind(id, workspaceId, entityId, weekStart, rank, NOW);
}

function changeRow(
  id: string,
  workspaceId: string,
  entityId: string,
  sourceId: string,
  observedAt: string,
  tombstoned: number,
): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, payload_json, dedup_key, observed_at, is_tombstoned) VALUES (?1, ?2, ?3, ?4, 'change', 'pricing', ?7, ?1, ?5, ?6)",
  ).bind(
    id,
    workspaceId,
    entityId,
    sourceId,
    observedAt,
    tombstoned,
    JSON.stringify({ before: { textKey: `${id}/before.txt` }, after: { textKey: `${id}/after.txt` } }),
  );
}

function noteworthyRow(id: string, workspaceId: string, entityId: string): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, decided_at) VALUES (?1, ?2, 'noteworthy_change', ?3, ?4, ?5, 0.95, ?6)",
  ).bind(`jv_${id}`, workspaceId, `jh_${id}`, id, entityId, NOW);
}

function hiringRow(
  id: string,
  workspaceId: string,
  entityId: string,
  sourceId: string,
  observedAt: string,
): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'hiring', 'Engineer', 'https://kindred.example/careers', ?1, ?5)",
  ).bind(id, workspaceId, entityId, sourceId, observedAt);
}

async function seedRail(): Promise<Seed> {
  runs += 1;
  const n = String(runs);
  const rows: Seed = {
    user: `user-rail-peers-${n}`,
    wsA: `ws-a-${n}`,
    wsB: `ws-b-${n}`,
    selfA: `self-a-${n}`,
    compOn: `comp-on-${n}`,
    compOff: `comp-off-${n}`,
    compB: `comp-b-${n}`,
    source: `src-rail-peers-${n}`,
  };

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'Rail', ?2, 1, ?3, ?3)",
    ).bind(rows.user, `${rows.user}@example.test`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, 'Rail A', ?2, 'UTC', ?3)",
    ).bind(rows.wsA, rows.user, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, 'Rail B', ?2, 'UTC', ?3)",
    ).bind(rows.wsB, rows.user, NOW),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'self', 'own.example', 'Own Brand', 'on', ?3)",
    ).bind(rows.selfA, rows.wsA, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', 'kindred.example', 'Kindred', 'on', ?3)",
    ).bind(rows.compOn, rows.wsA, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', 'casetta.example', NULL, 'off', ?3)",
    ).bind(rows.compOff, rows.wsA, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', 'rival.example', 'Rival', 'on', ?3)",
    ).bind(rows.compB, rows.wsB, NOW),
  ]);

  await env.DB.batch([
    standingRow(`st_old_self_${n}`, rows.wsA, rows.selfA, WEEK_OLD, 1),
    standingRow(`st_old_on_${n}`, rows.wsA, rows.compOn, WEEK_OLD, 2),
    standingRow(`st_old_off_${n}`, rows.wsA, rows.compOff, WEEK_OLD, 3),
    standingRow(`st_latest_on_${n}`, rows.wsA, rows.compOn, WEEK_LATEST, 1),
    standingRow(`st_latest_self_${n}`, rows.wsA, rows.selfA, WEEK_LATEST, 2),
    standingRow(`st_latest_off_${n}`, rows.wsA, rows.compOff, WEEK_LATEST, 3),
    standingRow(`st_todo_self_${n}`, rows.wsA, rows.selfA, WEEK_UNFROZEN, null),
    standingRow(`st_todo_on_${n}`, rows.wsA, rows.compOn, WEEK_UNFROZEN, null),
    standingRow(`st_todo_off_${n}`, rows.wsA, rows.compOff, WEEK_UNFROZEN, null),
    standingRow(`st_b_latest_${n}`, rows.wsB, rows.compB, WEEK_LATEST, 1),
  ]);

  await env.DB.prepare("INSERT INTO source (id, key, kind, platform, plugin_key) VALUES (?1, ?2, 'site', 'test', ?3)")
    .bind(rows.source, `rail-peers-${n}`, `rail-peers-${n}`)
    .run();

  await env.DB.batch([
    changeRow(`sig_change_a_${n}`, rows.wsA, rows.compOn, rows.source, "2026-09-19T12:00:00.000Z", 0),
    changeRow(`sig_change_b_${n}`, rows.wsA, rows.compOn, rows.source, "2026-09-11T12:00:00.000Z", 0),
    hiringRow(`sig_hiring_a_${n}`, rows.wsA, rows.compOn, rows.source, "2026-09-09T12:00:00.000Z"),
    changeRow(`sig_change_old_${n}`, rows.wsA, rows.compOn, rows.source, "2026-08-15T12:00:00.000Z", 0),
    changeRow(`sig_change_tombstoned_${n}`, rows.wsA, rows.compOn, rows.source, "2026-09-16T12:00:00.000Z", 1),
    changeRow(`sig_change_other_ws_${n}`, rows.wsB, rows.compB, rows.source, "2026-09-19T12:00:00.000Z", 0),
    noteworthyRow(`sig_change_a_${n}`, rows.wsA, rows.compOn),
    noteworthyRow(`sig_change_b_${n}`, rows.wsA, rows.compOn),
    noteworthyRow(`sig_change_old_${n}`, rows.wsA, rows.compOn),
    noteworthyRow(`sig_change_tombstoned_${n}`, rows.wsA, rows.compOn),
    noteworthyRow(`sig_change_other_ws_${n}`, rows.wsB, rows.compB),
  ]);

  return rows;
}

beforeEach(async () => {
  seed = await seedRail();
});

describe("the competitor rail's reads, against real D1", () => {
  it("returns the latest frozen week's peers, rank order, name falling back to domain", async () => {
    const peers = await readLatestPeers(env.DB, seed.wsA);

    expect(peers).toEqual([
      { entityId: seed.compOn, name: "Kindred", role: "competitor", state: "on", rank: 1 },
      { entityId: seed.selfA, name: "Own Brand", role: "self", state: "on", rank: 2 },
      { entityId: seed.compOff, name: "casetta.example", role: "competitor", state: "off", rank: 3 },
    ]);
  });

  it("counts only the trailing window's live signals on that brand in that workspace", async () => {
    const counts = await readSignalCounts(seed.wsA, seed.compOn, SINCE);

    expect(counts).toEqual([
      { kind: "change", count: 2 },
      { kind: "hiring", count: 1 },
    ]);
  });
});
