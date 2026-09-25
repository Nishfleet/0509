import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readHomeStandingInputs, SELECT_HOME_STANDING } from "../../app/lib/home-standing.server";

/**
 * Home's standing reader against real local D1: the owner's workspace, its
 * entities and the newest weekly digest, which is the same frozen week the
 * brief emailed, so Home and the email agree (docs/REBUILD-STANDING.md).
 */

let runs = 0;
let WS = "";
let USER = "";

async function seedWorkspace() {
  const createdAt = "2026-08-01T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'Home', ?2, 1, ?3, ?3)",
    ).bind(USER, `${USER}@example.test`, createdAt),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Home', ?2, 'Europe/London', 1, 8, ?3)",
    ).bind(WS, USER, createdAt),
    ...[
      ["self", "self", "own.example", "on"],
      ["rival", "competitor", "rival.example", "on"],
      ["paused", "competitor", "paused.example", "off"],
    ].map(([id, role, domain, state]) =>
      env.DB.prepare(
        "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      ).bind(`${WS}_${id}`, WS, role, domain, id, state, createdAt),
    ),
  ]);
}

async function seedDigest(id: string, periodEnd: string, rank: number) {
  const payload = {
    workspace_id: WS,
    timezone: "Europe/London",
    period_start: "2026-09-07T07:00:00.000Z",
    period_end: periodEnd,
    headline_rank: rank,
    headline_total: 2,
    why_line: `week ending ${periodEnd}`,
    brands: [],
  };
  await env.DB.prepare(
    "INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, payload_json) VALUES (?1, ?2, 'weekly', ?3, ?4, 'sent', ?5)",
  )
    .bind(`${WS}_${id}`, WS, payload.period_start, periodEnd, JSON.stringify(payload))
    .run();
}

async function seedStanding(label: string, weekStartAt: string, rank: number | null) {
  await env.DB.batch(
    ["self", "rival", "paused"].map((entity) =>
      env.DB.prepare(
        "INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, computed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      ).bind(`${WS}_${label}_${entity}`, WS, `${WS}_${entity}`, weekStartAt, rank ?? 0, rank, weekStartAt),
    ),
  );
}

beforeEach(async () => {
  runs += 1;
  WS = `ws_home_${String(runs)}`;
  USER = `user_home_${String(runs)}`;
  await seedWorkspace();
});

describe("readHomeStandingInputs", () => {
  it("reads the schedule, every entity and the newest weekly brief", async () => {
    await seedDigest("older", "2026-09-14T07:00:00.000Z", 2);
    await seedDigest("newest", "2026-09-21T07:00:00.000Z", 1);

    const inputs = await readHomeStandingInputs(env.DB, USER);

    expect(inputs?.schedule).toEqual({ timezone: "Europe/London", weekday: 1, hour: 8 });
    expect(inputs?.entities.map((entity) => [entity.role, entity.domain, entity.state]).sort()).toEqual([
      ["competitor", "paused.example", "off"],
      ["competitor", "rival.example", "on"],
      ["self", "own.example", "on"],
    ]);
    expect(inputs?.payload?.headline_rank).toBe(1);
    expect(inputs?.payload?.why_line).toBe("week ending 2026-09-21T07:00:00.000Z");
  });

  it("has no brief to show before the first week closes", async () => {
    const inputs = await readHomeStandingInputs(env.DB, USER);
    expect(inputs?.payload).toBeNull();
    expect(inputs?.entities).toHaveLength(3);
  });

  it("reads the entity name and falls back to the domain when it is null", async () => {
    await env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', 'noname.example', NULL, 'on', ?3)",
    )
      .bind(`${WS}_noname`, WS, "2026-08-02T00:00:00.000Z")
      .run();

    const inputs = await readHomeStandingInputs(env.DB, USER);

    expect(inputs?.entities.find((entity) => entity.domain === "rival.example")?.name).toBe("rival");
    expect(inputs?.entities.find((entity) => entity.domain === "noname.example")?.name).toBe("noname.example");
  });

  it("returns null for a user with no workspace", async () => {
    expect(await readHomeStandingInputs(env.DB, "user_nobody")).toBeNull();
  });

  it("reads and writes the newest brief through the digest index", async () => {
    await seedDigest("older", "2026-09-14T07:00:00.000Z", 2);
    await seedDigest("newest", "2026-09-21T07:00:00.000Z", 1);

    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${SELECT_HOME_STANDING}`)
      .bind(USER)
      .all<{ detail: string }>();
    const details = (plan.results ?? []).map((row) => row.detail);
    expect(details.some((detail) => detail.includes("idx_digest_ws_kind_period"))).toBe(true);
    expect(details.every((detail) => !detail.startsWith("SCAN "))).toBe(true);

    const inputs = await readHomeStandingInputs(env.DB, USER);
    expect(inputs?.payload?.headline_rank).toBe(1);
    expect(inputs?.payload?.why_line).toBe("week ending 2026-09-21T07:00:00.000Z");
  });

  it("keeps the oldest workspace when the owner has two", async () => {
    const newer = `${WS}_newer`;
    const createdAt = "2026-09-01T00:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Newer', ?2, 'UTC', 2, 9, ?3)",
      ).bind(newer, USER, createdAt),
      env.DB.prepare(
        "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'self', 'newer.example', 'newer', 'on', ?3)",
      ).bind(`${newer}_self`, newer, createdAt),
    ]);

    const inputs = await readHomeStandingInputs(env.DB, USER);
    expect(inputs?.schedule.timezone).toBe("Europe/London");
    expect(inputs?.entities.some((entity) => entity.domain === "newer.example")).toBe(false);
  });

  it("returns exactly the four newest frozen ranked weeks, ascending, with no null rank and no unranked week", async () => {
    const rankedWeeks = [
      "2026-08-24T07:00:00.000Z",
      "2026-08-31T07:00:00.000Z",
      "2026-09-07T07:00:00.000Z",
      "2026-09-14T07:00:00.000Z",
      "2026-09-20T23:00:00.000Z",
    ];
    for (const [index, week] of rankedWeeks.entries()) await seedStanding(week, week, index + 1);
    await seedStanding("unranked", "2026-09-22T07:00:00.000Z", null);

    const inputs = await readHomeStandingInputs(env.DB, USER);
    expect(inputs).not.toBeNull();
    const history = inputs?.history ?? [];

    for (const row of history) expect(Number.isInteger(row.rank)).toBe(true);
    const distinctWeeks = [...new Set(history.map((row) => row.week_start_at))];
    expect(distinctWeeks).toEqual(rankedWeeks.slice(1));
    expect(distinctWeeks).not.toContain("2026-09-22T07:00:00.000Z");
    expect(history).toHaveLength(12);
    for (const entity of ["self", "rival", "paused"]) {
      expect(history.filter((row) => row.entity_id === `${WS}_${entity}`).map((row) => row.rank)).toEqual([2, 3, 4, 5]);
    }
    expect([...history].sort((a, b) => a.week_start_at.localeCompare(b.week_start_at))).toEqual(history);
  });
});
