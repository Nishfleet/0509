import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { readAgentAlerts, readAgentCompetitor, readAgentCompetitors } from "../../app/lib/agent/read.server";

const NOW = "2026-10-02T12:00:00.000Z";
const USER_ID = "u_agent_off_alerts";
const WORKSPACE_ID = "ws_agent_off_alerts";
const ON_ID = "ent_agent_off_alerts_on";
const OFF_ID = "ent_agent_off_alerts_off";
const DISMISSED_ID = "sug_agent_off_alerts_dismissed";
const ON_CHANGE_ID = "sig_agent_off_alerts_on";
const OFF_CHANGE_ID = "sig_agent_off_alerts_off";
const CHANGE_SEEN_AT = new Date().toISOString();

async function seedCompetitorChange(input: {
  entityId: string;
  domain: string;
  signalId: string;
}): Promise<void> {
  const watchId = `watch_${input.entityId}`;
  const pageId = `page_${input.entityId}`;
  const beforeSnapshotId = `snap_${input.entityId}_before`;
  const afterSnapshotId = `snap_${input.entityId}_after`;
  const url = `https://${input.domain}/pricing`;
  const diffKey = `snapshot/site/${watchId}/site-change.diff.json`;
  const payload = {
    page: { role: "pricing", url },
    before: { snapshotId: beforeSnapshotId, screenshotKey: null },
    after: { snapshotId: afterSnapshotId, screenshotKey: null },
    diffKey,
    wordsAdded: 3,
    wordsRemoved: 2,
  };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES (?1, ?2, ?3, 'pricing', ?4)",
    ).bind(pageId, input.entityId, url, NOW),
    env.DB.prepare(
      "INSERT INTO watch (id, entity_id, source_id, target_key, last_polled_at) VALUES (?1, ?2, 'src_site_web', ?3, ?4)",
    ).bind(watchId, input.entityId, url, NOW),
    env.DB.prepare(
      "INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_hash) VALUES (?1, ?2, ?3, ?4, 'before-hash')",
    ).bind(beforeSnapshotId, watchId, pageId, NOW),
    env.DB.prepare(
      "INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_hash) VALUES (?1, ?2, ?3, ?4, 'after-hash')",
    ).bind(afterSnapshotId, watchId, pageId, NOW),
    env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, aspect, url, evidence_url,
         payload_json, dedup_key, observed_at, last_seen_at)
       VALUES (?1, ?2, ?3, 'src_site_web', ?4, ?5, 'change', 'pricing', ?6, ?6, ?7, ?5, ?8, ?8)`,
    ).bind(
      input.signalId,
      WORKSPACE_ID,
      input.entityId,
      watchId,
      afterSnapshotId,
      url,
      JSON.stringify(payload),
      CHANGE_SEEN_AT,
    ),
  ]);
  await env.SNAPSHOTS.put(
    diffKey,
    JSON.stringify({ hunks: [{ lines: [" context", "-Plans from $10.", "+Plans from $12."] }] }),
  );
}

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?1, ?2, ?3, 1, ?4, ?4)',
    ).bind(USER_ID, "Agent Off Alerts Owner", "agent-off-alerts@test.dev", NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, ?2, ?3, 'UTC', ?4)",
    ).bind(WORKSPACE_ID, "off-alerts", USER_ID, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, 'on', ?5)",
    ).bind(ON_ID, WORKSPACE_ID, "rival-on-alerts.example", "Rival On Alerts", NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, 'off', ?5)",
    ).bind(OFF_ID, WORKSPACE_ID, "rival-off-alerts.example", "Rival Off Alerts", NOW),
    env.DB.prepare(
      `INSERT INTO suggestion (
         id, workspace_id, entity_id, kind, candidate_domain, candidate_name,
         status, decided_by, decided_at, created_at
       ) VALUES (?1, ?2, NULL, 'add', ?3, ?4, 'dismissed', 'user', ?5, ?5)`,
    ).bind(DISMISSED_ID, WORKSPACE_ID, "dismissed-alerts.example", "Dismissed Rival", NOW),
  ]);
  await seedCompetitorChange({
    entityId: ON_ID,
    domain: "rival-on-alerts.example",
    signalId: ON_CHANGE_ID,
  });
  await seedCompetitorChange({
    entityId: OFF_ID,
    domain: "rival-off-alerts.example",
    signalId: OFF_CHANGE_ID,
  });
});

describe("agent alerts and competitors hide OFF brands and dismissed suggestions", () => {
  it("includes the ON brand's site change in readAgentAlerts and omits the OFF brand's", async () => {
    const { alerts } = await readAgentAlerts(WORKSPACE_ID);
    const changeIds = alerts.filter((alert) => alert.kind === "site_change").map((alert) => alert.id);
    expect(changeIds).toContain(ON_CHANGE_ID);
    expect(changeIds).not.toContain(OFF_CHANGE_ID);
  });

  it("lists the ON brand under tracked and omits the OFF brand and dismissed suggestion", async () => {
    const competitors = await readAgentCompetitors(WORKSPACE_ID);
    expect(competitors.tracked.map((row) => row.id)).toEqual([ON_ID]);
    const blob = JSON.stringify(competitors);
    expect(blob).not.toContain(OFF_ID);
    expect(blob).not.toContain(DISMISSED_ID);
    expect(blob).not.toContain("Rival Off Alerts");
    expect(blob).not.toContain("Dismissed Rival");
  });

  it("does not expose the OFF brand's changes from readAgentCompetitor", async () => {
    const result = await readAgentCompetitor(WORKSPACE_ID, OFF_ID, new Date());
    expect(result.competitor === null || result.competitor.changes.length === 0).toBe(true);
    expect(JSON.stringify(result)).not.toContain(OFF_CHANGE_ID);
  });
});
