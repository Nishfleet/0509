import { env, introspectWorkflow, introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseBriefPayload } from "../../../app/lib/brief-payload";
import type { BriefSchedule } from "../../../app/lib/brief-schedule";
import { instantStamp, nextBriefAt, openWeek, previousBriefAt, rolloverInstance } from "../../../app/lib/brief-schedule";
import { runNightlyStanding } from "../../../workers/standing/nightly";

/**
 * The weekly rollover and the nightly cron against real workerd, real local D1
 * and the real Workflows binding (0509#3978, 0509#4004).
 *
 * Dates are taken relative to the real clock: `step.sleepUntil` and the
 * successor instance run on real time, so a fixed date would either never wake
 * or wake a chain of successors once the calendar passed it.
 */

let runs = 0;
let WS = "";
let USER = "";
const SELF = "ent_self";
const RIVAL_A = "ent_rival_a";
const RIVAL_B = "ent_rival_b";
const RIVAL_C = "ent_rival_c";
const RIVAL_OFF = "ent_rival_off";
let SOURCE = "";

const hour = 60 * 60 * 1000;

function scheduleOffsetFromToday(days: number): BriefSchedule {
  return { timezone: "UTC", weekday: (new Date().getUTCDay() + days) % 7, hour: 8 };
}

async function seedWorkspace(schedule: BriefSchedule) {
  const createdAt = new Date(Date.now() - 60 * 24 * hour).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'Rollover', ?2, 1, ?3, ?3)",
    ).bind(USER, `${USER}@example.test`, createdAt),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Rollover', ?2, ?3, ?4, ?5, ?6)",
    ).bind(WS, USER, schedule.timezone, schedule.weekday, schedule.hour, createdAt),
    ...[
      [SELF, "self", "own.example", "Own Brand", "on"],
      [RIVAL_A, "competitor", "a.example", "Rival A", "on"],
      [RIVAL_B, "competitor", "b.example", "Rival B", "on"],
      [RIVAL_C, "competitor", "c.example", "Rival C", "on"],
      [RIVAL_OFF, "competitor", "off.example", "Rival Off", "off"],
    ].map(([id, role, domain, name, state]) =>
      env.DB.prepare(
        "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      ).bind(`${WS}_${id}`, WS, role, domain, name, state, createdAt),
    ),
    env.DB.prepare(
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability) VALUES (?1, ?1, 'mentions', ?1, ?1, 'rss')",
    ).bind(SOURCE),
  ]);
}

async function seedMention(slug: string, entity: string, observedAt: Date, p: number) {
  const id = `${WS}_${slug}`;
  const entityId = `${WS}_${entity}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, canonical_url, url_hash, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'mention', ?5, ?6, ?7, ?8)",
    ).bind(id, WS, entityId, SOURCE, `https://news.example/${id}`, `hash-${id}`, `dedup-${id}`, observedAt.toISOString()),
    env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at) VALUES (?1, ?2, 'mention_matters', ?3, ?4, ?5, ?6)",
    ).bind(`verdict-${id}`, WS, `input-${id}`, id, p, observedAt.toISOString()),
  ]);
}

async function seedTitledNotable(slug: string, entity: string, title: string, observedAt: Date) {
  const id = `${WS}_${slug}`;
  const entityId = `${WS}_${entity}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, canonical_url, url_hash, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'mention', ?5, ?6, ?7, ?8, ?9)",
    ).bind(id, WS, entityId, SOURCE, title, `https://news.example/${id}`, `hash-${id}`, `dedup-${id}`, observedAt.toISOString()),
    env.DB.prepare(
      "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, reason, decided_at) VALUES (?1, ?2, 'noteworthy_change', ?3, ?4, 0.95, NULL, ?5)",
    ).bind(`verdict-${id}`, WS, `input-${id}`, id, observedAt.toISOString()),
  ]);
  return id;
}

async function seedFrozenWeek(weekStartAt: string, ranks: readonly [string, number][]) {
  await env.DB.batch(
    ranks.map(([entity, rank]) =>
      env.DB.prepare(
        "INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, movement, computed_at) VALUES (?1, ?2, ?3, ?4, 0, ?5, NULL, ?4)",
      ).bind(`frozen-${WS}-${entity}`, WS, `${WS}_${entity}`, weekStartAt, rank),
    ),
  );
}

interface StandingRow {
  entity_id: string;
  score: number;
  rank: number | null;
  movement: number | null;
}

async function standingFor(weekStartAt: string): Promise<StandingRow[]> {
  const rows = await env.DB.prepare(
    "SELECT entity_id, score, rank, movement FROM standing WHERE workspace_id = ?1 AND week_start_at = ?2 ORDER BY entity_id",
  )
    .bind(WS, weekStartAt)
    .all<StandingRow>();
  return rows.results.map((row) => ({ ...row, entity_id: row.entity_id.slice(WS.length + 1) }));
}

const D4_TITLE_A = "Rival A ships a new pricing tier";
const D4_TITLE_B = "Rival B expands into three more cities";

interface StubRequest {
  state: { item: { title: string | null } };
}

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
});

beforeEach(() => {
  runs += 1;
  WS = `ws_rollover_${String(runs)}`;
  USER = `user_rollover_${String(runs)}`;
  SOURCE = `src_rollover_${String(runs)}`;
});

describe("the weekly rollover Workflow (0509#4004)", () => {
  it("freezes rank and movement, writes the brief, and schedules next week", async () => {
    const schedule = scheduleOffsetFromToday(3);
    await seedWorkspace(schedule);
    const closesAt = nextBriefAt(schedule, new Date());
    const startsAt = previousBriefAt(schedule, closesAt);
    const lastWeek = previousBriefAt(schedule, startsAt).toISOString();
    await seedFrozenWeek(lastWeek, [
      [SELF, 1],
      [RIVAL_A, 2],
      [RIVAL_B, 3],
    ]);
    const during = new Date(startsAt.getTime() + hour);
    await seedMention("m1", RIVAL_B, during, 0.95);
    await seedMention("m2", RIVAL_B, during, 0.95);
    await seedMention("m3", SELF, during, 0.95);
    await seedMention("m4", RIVAL_OFF, during, 0.95);

    const instance = rolloverInstance(WS, closesAt, "scheduled");
    await using introspector = await introspectWorkflowInstance(env.STANDING_ROLLOVER, instance.id);
    await introspector.modify(async (m) => {
      await m.disableSleeps();
    });
    await env.STANDING_ROLLOVER.create(instance);
    await introspector.waitForStatus("complete");

    const digestId = `digest_${WS}_${instantStamp(closesAt)}`;
    expect(await introspector.getOutput()).toEqual({
      workspaceId: WS,
      closesAt: closesAt.toISOString(),
      digestId,
      skipped: null,
    });

    expect(await standingFor(startsAt.toISOString())).toEqual([
      { entity_id: RIVAL_A, score: 0, rank: 3, movement: -1 },
      { entity_id: RIVAL_B, score: 5.4, rank: 1, movement: 2 },
      { entity_id: RIVAL_C, score: 0, rank: 4, movement: null },
      { entity_id: SELF, score: 2.7, rank: 2, movement: -1 },
    ]);

    const digest = await env.DB.prepare(
      "SELECT kind, status, period_start, period_end, payload_json FROM digest WHERE id = ?1",
    )
      .bind(digestId)
      .first<{ kind: string; status: string; period_start: string; period_end: string; payload_json: string }>();
    expect(digest?.kind).toBe("weekly");
    expect(digest?.status).toBe("pending");
    expect(digest?.period_start).toBe(startsAt.toISOString());
    expect(digest?.period_end).toBe(closesAt.toISOString());

    const brief = parseBriefPayload(digest?.payload_json ?? "");
    expect(brief.headline_rank).toBe(2);
    expect(brief.headline_total).toBe(4);
    expect(brief.headline_movement).toBe(-1);
    expect(brief.brands.map((line) => line.name)).toEqual(["Rival B", "Own Brand", "Rival A", "Rival C"]);
    expect(brief.brands.find((line) => line.name === "Rival C")?.is_new).toBe(true);
    expect(brief.brands.find((line) => line.name === "Rival B")?.mention_delta).toBe(2);
    expect(brief.checked.mention_count).toBe(3);
    expect(brief.why_line).toBe("Quiet week: 3 mentions checked, no site changes, no new ads.");
    expect(brief.next_brief_at).toBe(nextBriefAt(schedule, closesAt).toISOString());

    const successor = rolloverInstance(WS, nextBriefAt(schedule, closesAt), "scheduled");
    const next = await env.STANDING_ROLLOVER.get(successor.id);
    expect(["queued", "running", "waiting"]).toContain((await next.status()).status);
  });

  it("writes a paused workspace's brief as paused and sends nothing", async () => {
    const schedule = scheduleOffsetFromToday(3);
    await seedWorkspace(schedule);
    await env.DB.prepare("UPDATE workspace SET brief_paused_at = '2026-09-25T10:00:00.000Z' WHERE id = ?1")
      .bind(WS)
      .run();
    const closesAt = nextBriefAt(schedule, new Date());
    const startsAt = previousBriefAt(schedule, closesAt);
    const lastWeek = previousBriefAt(schedule, startsAt).toISOString();
    await seedFrozenWeek(lastWeek, [
      [SELF, 1],
      [RIVAL_A, 2],
      [RIVAL_B, 3],
    ]);
    const during = new Date(startsAt.getTime() + hour);
    await seedMention("p1", RIVAL_B, during, 0.95);
    await seedMention("p2", RIVAL_B, during, 0.95);
    await seedMention("p3", SELF, during, 0.95);

    const instance = rolloverInstance(WS, closesAt, "scheduled");
    await using introspector = await introspectWorkflowInstance(env.STANDING_ROLLOVER, instance.id);
    await introspector.modify(async (m) => {
      await m.disableSleeps();
    });
    await env.STANDING_ROLLOVER.create(instance);
    await introspector.waitForStatus("complete");

    const digestId = `digest_${WS}_${instantStamp(closesAt)}`;
    expect(await introspector.getOutput()).toMatchObject({ digestId, skipped: "brief_paused" });

    const digest = await env.DB.prepare("SELECT status FROM digest WHERE id = ?1")
      .bind(digestId)
      .first<{ status: string }>();
    expect(digest?.status).toBe("paused");

    const successor = rolloverInstance(WS, nextBriefAt(schedule, closesAt), "scheduled");
    const next = await env.STANDING_ROLLOVER.get(successor.id);
    expect(["queued", "running", "waiting"]).toContain((await next.status()).status);
  });

  it("sends again once resumed", async () => {
    const schedule = scheduleOffsetFromToday(3);
    await seedWorkspace(schedule);
    await env.DB.prepare("UPDATE workspace SET brief_paused_at = ?1 WHERE id = ?2")
      .bind("2026-09-25T10:00:00.000Z", WS)
      .run();
    await env.DB.prepare("UPDATE workspace SET brief_paused_at = NULL WHERE id = ?1").bind(WS).run();
    const closesAt = nextBriefAt(schedule, new Date());
    const startsAt = previousBriefAt(schedule, closesAt);
    const lastWeek = previousBriefAt(schedule, startsAt).toISOString();
    await seedFrozenWeek(lastWeek, [
      [SELF, 1],
      [RIVAL_A, 2],
      [RIVAL_B, 3],
    ]);
    const during = new Date(startsAt.getTime() + hour);
    await seedMention("q1", RIVAL_B, during, 0.95);
    await seedMention("q2", RIVAL_B, during, 0.95);
    await seedMention("q3", SELF, during, 0.95);

    const instance = rolloverInstance(WS, closesAt, "scheduled");
    await using introspector = await introspectWorkflowInstance(env.STANDING_ROLLOVER, instance.id);
    await introspector.modify(async (m) => {
      await m.disableSleeps();
    });
    await env.STANDING_ROLLOVER.create(instance);
    await introspector.waitForStatus("complete");

    const digestId = `digest_${WS}_${instantStamp(closesAt)}`;
    expect(await introspector.getOutput()).toMatchObject({ digestId, skipped: null });

    const digest = await env.DB.prepare("SELECT status FROM digest WHERE id = ?1")
      .bind(digestId)
      .first<{ status: string }>();
    expect(digest?.status).toBe("pending");
  });

  it("names only competitors paused during the ranked week in the why-line", async () => {
    const schedule = scheduleOffsetFromToday(3);
    await seedWorkspace(schedule);
    const closesAt = nextBriefAt(schedule, new Date());
    const startsAt = previousBriefAt(schedule, closesAt);
    const pausedDuring = new Date(startsAt.getTime() + hour).toISOString();
    const pausedBefore = new Date(startsAt.getTime() - hour).toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE entity SET state_changed_at = ?1, state_changed_by = 'user' WHERE workspace_id = ?2 AND id = ?3",
      ).bind(pausedDuring, WS, `${WS}_${RIVAL_OFF}`),
      env.DB.prepare(
        "INSERT INTO entity (id, workspace_id, role, domain, name, state, state_changed_at, state_changed_by, created_at) VALUES (?1, ?2, 'competitor', 'before.example', 'Rival Before', 'off', ?3, 'user', ?3)",
      ).bind(`${WS}_before`, WS, pausedBefore),
    ]);

    const instance = rolloverInstance(WS, closesAt, "scheduled");
    await using introspector = await introspectWorkflowInstance(env.STANDING_ROLLOVER, instance.id);
    await introspector.modify(async (m) => {
      await m.disableSleeps();
    });
    await env.STANDING_ROLLOVER.create(instance);
    await introspector.waitForStatus("complete");

    const digestId = `digest_${WS}_${instantStamp(closesAt)}`;
    const digest = await env.DB.prepare("SELECT payload_json FROM digest WHERE id = ?1")
      .bind(digestId)
      .first<{ payload_json: string }>();
    const brief = parseBriefPayload(digest?.payload_json ?? "");

    expect(brief.why_line).toContain("Rival Off paused, so every brand below it moved up.");
    expect(brief.why_line).not.toContain("Rival Before");
  });

  it("stands down when the workspace moved its brief time", async () => {
    const schedule = scheduleOffsetFromToday(3);
    await seedWorkspace({ ...schedule, hour: 9 });
    const instance = rolloverInstance(WS, nextBriefAt(schedule, new Date()), "scheduled");

    await using introspector = await introspectWorkflowInstance(env.STANDING_ROLLOVER, instance.id);
    await introspector.modify(async (m) => {
      await m.disableSleeps();
    });
    await env.STANDING_ROLLOVER.create(instance);
    await introspector.waitForStatus("complete");

    expect(await introspector.getOutput()).toMatchObject({ digestId: null, skipped: "schedule_moved" });
    const digests = await env.DB.prepare("SELECT COUNT(*) AS n FROM digest WHERE workspace_id = ?1")
      .bind(WS)
      .first<{ n: number }>();
    expect(digests?.n).toBe(0);
  });

  it("carries the week's read-this-first marks and names the lead brand", async () => {
    const schedule = scheduleOffsetFromToday(3);
    await seedWorkspace(schedule);
    const closesAt = nextBriefAt(schedule, new Date());
    const startsAt = previousBriefAt(schedule, closesAt);
    const lastWeek = previousBriefAt(schedule, startsAt).toISOString();
    await seedFrozenWeek(lastWeek, [
      [SELF, 1],
      [RIVAL_A, 2],
      [RIVAL_B, 3],
    ]);
    const during = new Date(startsAt.getTime() + hour);
    const first = await seedTitledNotable("d4a", RIVAL_A, D4_TITLE_A, during);
    const second = await seedTitledNotable("d4b", RIVAL_B, D4_TITLE_B, new Date(during.getTime() + 1000));
    const run = vi.fn(async (_model: string, request: StubRequest) => {
      const probability = request.state.item.title === D4_TITLE_A ? 0.8 : 0.6;
      return { answers: { read_this_first: { type: "boolean", probability } } };
    });
    Reflect.set(env, "AI", { run });

    const instance = rolloverInstance(WS, closesAt, "scheduled");
    await using introspector = await introspectWorkflowInstance(env.STANDING_ROLLOVER, instance.id);
    await introspector.modify(async (m) => {
      await m.disableSleeps();
    });
    await env.STANDING_ROLLOVER.create(instance);
    await introspector.waitForStatus("complete");

    const digestId = `digest_${WS}_${instantStamp(closesAt)}`;
    const digest = await env.DB.prepare("SELECT payload_json FROM digest WHERE id = ?1")
      .bind(digestId)
      .first<{ payload_json: string }>();
    const brief = parseBriefPayload(digest?.payload_json ?? "");

    expect(brief.read_this_first.map((mark) => mark.signal_id)).toEqual([first, second]);
    expect(brief.read_this_first[0]?.entity_name).toBe("Rival A");
    expect(brief.why_line).toBe("2 of 2 worth knowing this week, led by Rival A.");
    expect(brief.is_quiet_week).toBe(false);
  });

  it("falls back to the quiet-week brief when the D4 judge is unavailable", async () => {
    const schedule = scheduleOffsetFromToday(3);
    await seedWorkspace(schedule);
    const closesAt = nextBriefAt(schedule, new Date());
    const startsAt = previousBriefAt(schedule, closesAt);
    const lastWeek = previousBriefAt(schedule, startsAt).toISOString();
    await seedFrozenWeek(lastWeek, [
      [SELF, 1],
      [RIVAL_A, 2],
      [RIVAL_B, 3],
    ]);
    const during = new Date(startsAt.getTime() + hour);
    await seedTitledNotable("d4c", RIVAL_A, D4_TITLE_A, during);
    await seedTitledNotable("d4d", RIVAL_B, D4_TITLE_B, new Date(during.getTime() + 1000));
    const run = vi.fn(() => Promise.reject(new Error("Jev is down")));
    Reflect.set(env, "AI", { run });

    const instance = rolloverInstance(WS, closesAt, "scheduled");
    await using introspector = await introspectWorkflowInstance(env.STANDING_ROLLOVER, instance.id);
    await introspector.modify(async (m) => {
      await m.disableSleeps();
    });
    await env.STANDING_ROLLOVER.create(instance);
    await introspector.waitForStatus("complete");

    const digestId = `digest_${WS}_${instantStamp(closesAt)}`;
    const digest = await env.DB.prepare("SELECT payload_json FROM digest WHERE id = ?1")
      .bind(digestId)
      .first<{ payload_json: string }>();
    const brief = parseBriefPayload(digest?.payload_json ?? "");

    expect(brief.read_this_first).toEqual([]);
    expect(brief.why_line.startsWith("Quiet week:")).toBe(true);
    expect(brief.is_quiet_week).toBe(true);
  });

  it("writes no brief when only the own brand is on, and still schedules next week", async () => {
    const schedule = scheduleOffsetFromToday(3);
    await seedWorkspace(schedule);
    await env.DB.prepare("UPDATE entity SET state = 'off' WHERE workspace_id = ?1 AND role = 'competitor'").bind(WS).run();
    const closesAt = nextBriefAt(schedule, new Date());
    const instance = rolloverInstance(WS, closesAt, "scheduled");

    await using introspector = await introspectWorkflowInstance(env.STANDING_ROLLOVER, instance.id);
    await introspector.modify(async (m) => {
      await m.disableSleeps();
    });
    await env.STANDING_ROLLOVER.create(instance);
    await introspector.waitForStatus("complete");

    expect(await introspector.getOutput()).toMatchObject({ digestId: null, skipped: "nothing_to_compare" });
    const digests = await env.DB.prepare("SELECT COUNT(*) AS n FROM digest WHERE workspace_id = ?1")
      .bind(WS)
      .first<{ n: number }>();
    expect(digests?.n).toBe(0);
    const successor = await env.STANDING_ROLLOVER.get(
      rolloverInstance(WS, nextBriefAt(schedule, closesAt), "scheduled").id,
    );
    expect(["queued", "running", "waiting"]).toContain((await successor.status()).status);
  });
});

describe("the nightly standing cron (0509#3978)", () => {
  it("refreshes the open week unranked, schedules the next rollover, and catches up a missed one", async () => {
    const schedule = scheduleOffsetFromToday(3);
    await seedWorkspace(schedule);
    const now = new Date();
    const week = openWeek(schedule, now);
    const missedWeek = previousBriefAt(schedule, week.startsAt).toISOString();
    await env.DB.batch(
      [SELF, RIVAL_A].map((entityId) =>
        env.DB.prepare(
          "INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, computed_at) VALUES (?1, ?2, ?3, ?4, 1, ?4)",
        ).bind(`missed-${WS}-${entityId}`, WS, `${WS}_${entityId}`, missedWeek),
      ),
    );
    await seedMention("m5", RIVAL_A, new Date(week.startsAt.getTime() + hour), 0.95);

    await using introspector = await introspectWorkflow(env.STANDING_ROLLOVER);
    const result = await runNightlyStanding(env, now);

    expect(result).toMatchObject({ failed: 0, catchUps: 1 });
    expect((await standingFor(week.startsAt.toISOString())).map((row) => [row.entity_id, row.rank])).toEqual([
      [RIVAL_A, null],
      [RIVAL_B, null],
      [RIVAL_C, null],
      [SELF, null],
    ]);

    const scheduled = rolloverInstance(WS, week.closesAt, "scheduled");
    const catchUp = rolloverInstance(WS, week.startsAt, "catch-up");
    const created = await introspector.get();
    expect(created.length).toBeGreaterThanOrEqual(2);

    const catchUpInstance = await env.STANDING_ROLLOVER.get(catchUp.id);
    const pending = await env.STANDING_ROLLOVER.get(scheduled.id);
    expect(["queued", "running", "waiting"]).toContain((await pending.status()).status);

    await expect.poll(async () => (await catchUpInstance.status()).status, { timeout: 20_000 }).toBe("complete");
    expect((await standingFor(missedWeek)).map((row) => [row.entity_id, row.rank])).toEqual([
      [RIVAL_A, 1],
      [RIVAL_B, 2],
      [RIVAL_C, 3],
      [SELF, 4],
    ]);

    const again = await runNightlyStanding(env, now);
    expect(again).toMatchObject({ failed: 0, catchUps: 0 });
  });
});
