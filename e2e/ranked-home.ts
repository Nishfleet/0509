import type { DatabaseSync } from "node:sqlite";

import { run, seedPreviewSession } from "./preview-session";

// The ranked Home the moved /app specs read. The static /design/ranked-rows
// route used to render a fixed three-row standing to anyone; 0509#5657 removed
// it and moved both specs onto /app, so the standing they assert now has to be
// seeded. This is the one fixture: Loopwell is the self row, Kindred ranks
// first with two site changes and a mention, Casetta has no signals this week
// and reads a dash, one mentions source is degraded so the degraded pill is in
// the Axe scan, and four frozen weeks feed the four-week chart. Both specs read
// it, so the two cannot drift into different standings.
//
// kind 'change' needs an aspect and kind 'mention' needs a canonical_url and a
// url_hash; both are the schema's own CHECK constraints, not this fixture's
// rules.
export function seedRankedHome({
  db,
  suffix,
  userId,
}: {
  db: DatabaseSync;
  suffix: string;
  userId: string;
}): void {
  const workspaceId = `ws-${suffix}`;
  const selfId = `ent_self-${suffix}`;
  const kindredId = `ent_kindred-${suffix}`;
  const casettaId = `ent_casetta-${suffix}`;
  const stamp = "2026-09-25T00:00:00.000Z";
  const periodStart = "2026-09-14T07:00:00.000Z";
  const periodEnd = "2026-09-21T07:00:00.000Z";

  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'Europe/London', 1, 8, ?)",
    workspaceId,
    "Ranked Home",
    userId,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'self', 'loopwell.example', 'Loopwell', 'on', ?)",
    selfId,
    workspaceId,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'competitor', 'kindred.example', 'Kindred', 'on', ?)",
    kindredId,
    workspaceId,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'competitor', 'casetta.example', 'Casetta', 'on', ?)",
    casettaId,
    workspaceId,
    stamp,
  );

  const payload = {
    workspace_id: workspaceId,
    timezone: "Europe/London",
    period_start: periodStart,
    period_end: periodEnd,
    headline_rank: 2,
    headline_total: 3,
    headline_movement: 1,
    headline_is_new: false,
    why_line: "Kindred is the mover: 3 new ads",
    is_quiet_week: false,
    is_unjudged: false,
    read_this_first: [],
    brands: [
      {
        entity_id: kindredId,
        name: "Kindred",
        rank: 1,
        movement: 1,
        is_new: false,
        biggest_move: "Kindred launched 3 new ads",
        ad_delta: 2,
        mention_delta: 1,
        site_change_count: 2,
        new_roles: 0,
      },
      {
        entity_id: selfId,
        name: "Loopwell",
        rank: 2,
        movement: 0,
        is_new: false,
        biggest_move: null,
        ad_delta: 1,
        mention_delta: 0,
        site_change_count: 0,
        new_roles: 0,
      },
      {
        entity_id: casettaId,
        name: "Casetta",
        rank: 3,
        movement: null,
        is_new: false,
        biggest_move: null,
        ad_delta: 0,
        mention_delta: 0,
        site_change_count: 0,
        new_roles: 0,
      },
    ],
    own_site: { status: "ok", incidents: [] },
    checked: {
      mention_count: 1,
      site_change_count: 2,
      new_ad_count: 2,
      source_keys: ["site.web", "gdelt.doc"],
      degraded_source_keys: ["hn.algolia"],
      degraded_sources: [{ key: "hn.algolia", name: "Hacker News", last_landed_at: null }],
    },
    next_brief_at: null,
  };
  run(
    db,
    "INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, payload_json) VALUES (?, ?, 'weekly', ?, ?, 'sent', ?)",
    `${workspaceId}_digest`,
    workspaceId,
    periodStart,
    periodEnd,
    JSON.stringify(payload),
  );

  // Four frozen weeks, oldest first: Loopwell 3,3,2,2; Kindred 2,1,1,1;
  // Casetta 1,2,3,3. The /app row's four-week table asserts these.
  const weeks = [
    "2026-08-24T07:00:00.000Z",
    "2026-08-31T07:00:00.000Z",
    "2026-09-07T07:00:00.000Z",
    "2026-09-14T07:00:00.000Z",
  ];
  const chartRanks = [selfId, kindredId, casettaId].map((entityId) => {
    if (entityId === selfId) return [3, 3, 2, 2];
    if (entityId === kindredId) return [2, 1, 1, 1];
    return [1, 2, 3, 3];
  });
  const standingValues: string[] = [];
  for (const [weekIndex, week] of weeks.entries()) {
    for (const [entityIndex, entityId] of [selfId, kindredId, casettaId].entries()) {
      const rank = chartRanks[entityIndex]?.[weekIndex] ?? 0;
      standingValues.push(
        `('${workspaceId}_stand_${entityIndex}_${weekIndex}', '${workspaceId}', '${entityId}', '${week}', 0, ${rank}, '${week}')`,
      );
    }
  }
  run(
    db,
    `INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, computed_at) VALUES ${standingValues.join(", ")}`,
  );

  // Kindred's week: three signals since the period's start, so its row's pills
  // read site checks 2 live, news 1 live, Hacker News degraded and YouTube
  // none, and its opened row carries the Site changes 2 / Mentions 1 tabs.
  run(
    db,
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, dedup_key, observed_at, is_tombstoned, title, summary, url, evidence_url, payload_json) VALUES
       (?1, ?2, ?3, 'src_site_web', 'change', 'home', ?4, ?5, 0, 'Pricing page rewrote its hero', NULL, 'https://kindred.example/pricing', NULL, '{}'),
       (?6, ?2, ?3, 'src_site_web', 'change', 'home', ?7, ?8, 0, NULL, 'Docs link added to the nav', NULL, NULL, '{}')`,
    `sig_ev_1-${suffix}`,
    workspaceId,
    kindredId,
    `dedup_ev_1-${suffix}`,
    "2026-09-20T10:00:00.000Z",
    `sig_ev_2-${suffix}`,
    `dedup_ev_2-${suffix}`,
    "2026-09-19T09:00:00.000Z",
  );
  run(
    db,
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, observed_at, is_tombstoned, title, canonical_url, url_hash, payload_json) VALUES
       (?1, ?2, ?3, 'src_mentions_gdelt', 'mention', ?4, ?5, 0, 'Kindred mentioned on r/sysadmin', ?6, ?7, '{}')`,
    `sig_ev_3-${suffix}`,
    workspaceId,
    kindredId,
    `dedup_ev_3-${suffix}`,
    "2026-09-18T08:00:00.000Z",
    "https://www.reddit.com/r/sysadmin/comments/abc",
    `hash_ev_3-${suffix}`,
  );
}

export function seedRankedHomeSession(prefix: string): Promise<string> {
  return seedPreviewSession(prefix, seedRankedHome);
}
