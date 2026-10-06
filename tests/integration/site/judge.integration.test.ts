import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { insertVerdict } from "../../../app/lib/data/jev_verdict.server";
import { JevRateLimitedError } from "../../../app/lib/jev/client.server";
import { computeBreakageEvidence } from "../../../app/lib/site/breakage-evidence";
import { judgeChange, rejudgeUnjudgedChanges } from "../../../app/lib/site/judge.server";

const jevAnswers = {
  noul: new Map<string, number>(),
  choice: new Map<string, string>(),
  calls: 0,
  states: [] as unknown[],
};

const jevFailures = { next: 0, message: "gateway down" };

function installJev(): void {
  Reflect.set(env, "AI", {
    async run(_model: string, request: { state: unknown; questions: Record<string, { type: string }> }) {
      jevAnswers.states.push(request.state);
      jevAnswers.calls += 1;
      if (jevFailures.next > 0) {
        jevFailures.next -= 1;
        throw new Error(jevFailures.message);
      }
      const answers: Record<string, { type: "noul"; noul: number } | { type: "choice"; choice: string }> = {};
      for (const [id, question] of Object.entries(request.questions)) {
        if (question.type === "noul") {
          const p = jevAnswers.noul.get(id);
          if (p === undefined) throw new Error(`no answer for ${id}`);
          answers[id] = { type: "noul", noul: p };
        } else {
          const choice = jevAnswers.choice.get(id);
          if (choice === undefined) throw new Error(`no answer for ${id}`);
          answers[id] = { type: "choice", choice };
        }
      }
      return { answers };
    },
  });
}

const NOW = new Date().toISOString();

async function seedWorkspace(ws: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Owner', ?, 1, ?, ?)`,
  )
    .bind(`user-${ws}`, `${ws}@0509.io`, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, ?, ?, 'UTC', 1, 8, ?)`,
  )
    .bind(ws, ws, `user-${ws}`, NOW)
    .run();
}

async function seedHistory(entity: string, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, summary, aspect, url, dedup_key, observed_at, last_seen_at)
       VALUES (?, 'ws-mine', ?, 'src_site_web', 'change', ?, 'home', ?, ?, ?, ?)`,
    )
      .bind(
        `sig-${entity}-${index}`,
        entity,
        `change ${index}`,
        `https://${entity}.example/`,
        `dedup-${entity}-${index}`,
        NOW,
        NOW,
      )
      .run();
  }
}

async function seedChangeSignals(entity: string, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, url, payload_json, dedup_key, observed_at)
       VALUES (?1, 'ws-mine', ?2, 'src_site_web', 'change', 'home', ?3, '{}', ?4, ?5)`,
    )
      .bind(`sig-${entity}-${index}`, entity, `https://${entity}.example/${index}`, `dedup-${entity}-${index}`, NOW)
      .run();
  }
}

function judgeAt(entity: string, isSelf: boolean, index: number) {
  return { ...judgeInput({ entity, isSelf }), pageUrl: `https://${entity}.example/p${index}` };
}

function todayWindow(workspaceId: string) {
  return {
    workspaceId,
    windowStartAt: new Date(Date.parse(NOW) - 86_400_000).toISOString(),
    windowEndAt: new Date(Date.parse(NOW) + 86_400_000).toISOString(),
  };
}

function judgeInput(input: {
  entity: string;
  isSelf: boolean;
  ws?: string;
  subjectName?: string;
}): Parameters<typeof judgeChange>[0] {
  return {
    workspaceId: input.ws ?? "ws-mine",
    entityId: input.entity,
    signalId: null,
    isSelf: input.isSelf,
    subject: { name: input.subjectName ?? "Rival", domain: `${input.entity}.example` },
    pageUrl: `https://${input.entity}.example/`,
    pageRole: "home",
    hunks: [{ lines: ["-Plans from $10", "+Plans from $12"] }],
    evidence: computeBreakageEvidence({ status: 200, beforeText: "Plans from $10.", afterText: "Plans from $12." }),
  };
}

async function rowsFor(
  entity: string,
): Promise<
  { question_id: string; p: number | null; choice: string | null; entity_id: string | null; reason: string | null }[]
> {
  const result = await env.DB.prepare(
    "SELECT question_id, p, choice, entity_id, reason FROM jev_verdict WHERE entity_id = ? ORDER BY question_id",
  )
    .bind(entity)
    .all<{
      question_id: string;
      p: number | null;
      choice: string | null;
      entity_id: string | null;
      reason: string | null;
    }>();
  return result.results;
}

describe("judgeChange", () => {
  beforeEach(async () => {
    for (const table of ["signal", "snapshot", "watch", "page", "entity", "workspace", '"user"']) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec("DELETE FROM jev_verdict");
    jevAnswers.noul.clear();
    jevAnswers.choice.clear();
    jevAnswers.calls = 0;
    jevAnswers.states.length = 0;
    jevFailures.next = 0;
    jevFailures.message = "gateway down";
    installJev();
    await seedWorkspace("ws-mine");
    await seedWorkspace("ws-history");
    for (const [entity, role] of [
      ["mine", "self"],
      ["rival", "competitor"],
      ["noisy", "competitor"],
      ["broken", "competitor"],
    ] as const) {
      await env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, 'ws-mine', ?, ?, ?, 'on', ?)`,
      )
        .bind(entity, role, `${entity}.example`, entity, NOW)
        .run();
    }
    for (const entity of ["dated", "over"]) {
      await env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, 'ws-history', 'competitor', ?, ?, 'on', ?)`,
      )
        .bind(entity, `${entity}.example`, entity, NOW)
        .run();
    }
  });

  afterEach(() => {
    Reflect.deleteProperty(env, "AI");
  });

  it("case a: a competitor change at 0.95 publishes with kind and two logged verdicts", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "pricing");
    await seedHistory("rival", 3);

    const judgment = await judgeChange(judgeInput({ entity: "rival", isSelf: false }));

    expect(judgment.deferred).toBe(false);
    expect(judgment.selfBreakage).toBeNull();
    expect(judgment.noteworthy).toEqual({ p: 0.95, kind: "pricing", band: "publish" });
    expect(await rowsFor("rival")).toEqual([
      { question_id: "change_kind", p: null, choice: "pricing", entity_id: "rival", reason: null },
      { question_id: "noteworthy_change", p: 0.95, choice: null, entity_id: "rival", reason: null },
    ]);
    const leaked = await env.DB.prepare("SELECT COUNT(*) AS n FROM jev_verdict WHERE reason LIKE '%p=%'").first<{
      n: number;
    }>();
    expect(leaked).toMatchObject({ n: 0 });
    const anyReason = await env.DB.prepare("SELECT COUNT(*) AS n FROM jev_verdict WHERE reason IS NOT NULL").first<{
      n: number;
    }>();
    expect(anyReason).toMatchObject({ n: 0 });
  });

  it("case b: a competitor change at 0.5 stays uncertain", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.5);
    jevAnswers.choice.set("change_kind", "copy");

    const judgment = await judgeChange(judgeInput({ entity: "rival", isSelf: false }));

    expect(judgment.noteworthy).toEqual({ p: 0.5, kind: "copy", band: "uncertain" });
    expect(await rowsFor("rival")).toHaveLength(2);
  });

  it("case b2: a price change at 0.62 publishes, since Clef scores real price changes from 0.62", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.62);
    jevAnswers.choice.set("change_kind", "pricing");

    const judgment = await judgeChange(judgeInput({ entity: "rival", isSelf: false }));

    expect(judgment.noteworthy).toEqual({ p: 0.62, kind: "pricing", band: "publish" });
  });

  it("case b3: a price change just under 0.6 and a non-price change at 0.62 stay uncertain", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.59);
    jevAnswers.choice.set("change_kind", "pricing");
    const under = await judgeChange(judgeInput({ entity: "rival", isSelf: false }));
    expect(under.noteworthy).toEqual({ p: 0.59, kind: "pricing", band: "uncertain" });

    jevAnswers.noul.set("noteworthy_change", 0.62);
    jevAnswers.choice.set("change_kind", "launch");
    const other = await judgeChange(judgeInput({ entity: "noisy", isSelf: false }));
    expect(other.noteworthy).toEqual({ p: 0.62, kind: "launch", band: "uncertain" });
  });

  it("case c: a competitor change at 0.05 discards but still logs both verdicts", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.05);
    jevAnswers.choice.set("change_kind", "copy");

    const judgment = await judgeChange(judgeInput({ entity: "rival", isSelf: false }));

    expect(judgment.noteworthy).toEqual({ p: 0.05, kind: "copy", band: "discard" });
    expect(await rowsFor("rival")).toEqual([
      { question_id: "change_kind", p: null, choice: "copy", entity_id: "rival", reason: null },
      { question_id: "noteworthy_change", p: 0.05, choice: null, entity_id: "rival", reason: null },
    ]);
  });

  it("case c2: kind noise discards a would-be publish", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "noise");

    const judgment = await judgeChange(judgeInput({ entity: "noisy", isSelf: false }));

    expect(judgment.noteworthy?.band).toBe("discard");
    expect(judgment.noteworthy?.kind).toBe("noise");
  });

  it("case d: self breakage returns the D3s band, no noteworthy, and the client called once", async () => {
    jevAnswers.noul.set("own_site_breakage", 0.7);
    jevAnswers.choice.set("change_kind", "copy");

    const judgment = await judgeChange(judgeInput({ entity: "mine", isSelf: true }));

    expect(judgment.deferred).toBe(false);
    expect(judgment.selfBreakage).toEqual({ p: 0.7, band: "alert" });
    expect(judgment.noteworthy).toBeNull();
    expect(jevAnswers.calls).toBe(1);
    expect(await rowsFor("mine")).toEqual([
      { question_id: "own_site_breakage", p: 0.7, choice: null, entity_id: "mine", reason: null },
    ]);
    const leaked = await env.DB.prepare("SELECT COUNT(*) AS n FROM jev_verdict WHERE reason LIKE '%p=%'").first<{
      n: number;
    }>();
    expect(leaked).toMatchObject({ n: 0 });
    const anyReason = await env.DB.prepare("SELECT COUNT(*) AS n FROM jev_verdict WHERE reason IS NOT NULL").first<{
      n: number;
    }>();
    expect(anyReason).toMatchObject({ n: 0 });
  });

  it("case d2: a self change rated clear runs D3 too", async () => {
    jevAnswers.noul.set("own_site_breakage", 0.0);
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "pricing");

    const judgment = await judgeChange(judgeInput({ entity: "mine", isSelf: true }));

    expect(judgment.selfBreakage?.band).toBe("clear");
    expect(judgment.noteworthy?.band).toBe("publish");
    expect(await rowsFor("mine")).toHaveLength(3);
  });

  it("case e: the same change in two workspaces logs a verdict in each", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "pricing");

    await judgeChange(judgeInput({ entity: "rival", isSelf: false }));
    await judgeChange({
      ...judgeInput({ entity: "rival", isSelf: false }),
      workspaceId: "ws-history",
      entityId: "dated",
    });

    expect(await rowsFor("rival")).toHaveLength(2);
    expect(await rowsFor("dated")).toHaveLength(2);
  });

  it("case f: an entity at budget defers without calling the client", async () => {
    for (let index = 0; index < 6; index += 1) {
      await insertVerdict({
        workspaceId: "ws-history",
        questionId: "noteworthy_change",
        inputHash: `seeded-${index}`,
        signalId: null,
        entityId: "over",
        p: 0.9,
        choice: null,
        reason: null,
        decidedAt: NOW,
      }).run();
    }

    const judgment = await judgeChange(judgeInput({ entity: "over", isSelf: false, ws: "ws-history" }));

    expect(judgment).toEqual({ deferred: true, selfBreakage: null, noteworthy: null, verdictIds: [] });
    expect(jevAnswers.calls).toBe(0);
  });

  const seedToday = async (entityId: string, workspaceId: string, questionId: string, count: number) => {
    for (let index = 0; index < count; index += 1) {
      await insertVerdict({
        workspaceId,
        questionId,
        inputHash: `${questionId}-${entityId}-${index}`,
        signalId: null,
        entityId,
        p: 0.04,
        choice: null,
        reason: null,
        decidedAt: NOW,
      }).run();
    }
  };

  it("case f3: an own site whose budget went on mention verdicts is still checked, and the breakage verdict is kept", async () => {
    await seedToday("mine", "ws-mine", "mention_is_about_brand", 17);
    jevAnswers.noul.set("own_site_breakage", 0.7);

    const judgment = await judgeChange(judgeInput({ entity: "mine", isSelf: true }));

    expect(judgment.deferred).toBe(false);
    expect(judgment.selfBreakage).toEqual({ p: 0.7, band: "alert" });
    expect(judgment.verdictIds).toHaveLength(1);
    expect((await rowsFor("mine")).filter((row) => row.question_id === "own_site_breakage")).toHaveLength(1);
  });

  it("case f4: an own site over its change budget with a clear page is deferred and keeps the breakage verdict", async () => {
    await seedToday("mine", "ws-mine", "noteworthy_change", 6);
    jevAnswers.noul.set("own_site_breakage", 0.0);

    const judgment = await judgeChange(judgeInput({ entity: "mine", isSelf: true }));

    expect(judgment.deferred).toBe(true);
    expect(judgment.selfBreakage).toEqual({ p: 0, band: "clear" });
    expect(judgment.noteworthy).toBeNull();
    expect(judgment.verdictIds).toHaveLength(1);
    expect(jevAnswers.calls).toBe(1);
    expect((await rowsFor("mine")).filter((row) => row.question_id === "own_site_breakage")).toHaveLength(1);
  });

  it("case f5: mention verdicts never defer a competitor change", async () => {
    await seedToday("rival", "ws-mine", "mention_is_about_brand", 40);
    await seedToday("rival", "ws-mine", "mention_matters", 40);
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "pricing");

    const judgment = await judgeChange(judgeInput({ entity: "rival", isSelf: false }));

    expect(judgment.deferred).toBe(false);
    expect(judgment.noteworthy?.band).toBe("publish");
  });

  it("case f6: breakage checks stay bounded per own site per day", async () => {
    await seedToday("mine", "ws-mine", "own_site_breakage", 6);
    jevAnswers.noul.set("own_site_breakage", 0.9);

    const judgment = await judgeChange(judgeInput({ entity: "mine", isSelf: true }));

    expect(judgment).toEqual({ deferred: true, selfBreakage: null, noteworthy: null, verdictIds: [] });
    expect(jevAnswers.calls).toBe(0);
  });

  it("case f2: an entity outside the budget window does not use up budget", async () => {
    for (let index = 0; index < 6; index += 1) {
      await insertVerdict({
        workspaceId: "ws-history",
        questionId: "noteworthy_change",
        inputHash: `stale-${index}`,
        signalId: null,
        entityId: "dated",
        p: 0.9,
        choice: null,
        reason: null,
        decidedAt: new Date(Date.now() - 3 * 24 * 3_600_000).toISOString(),
      }).run();
    }
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "pricing");

    const judgment = await judgeChange(judgeInput({ entity: "dated", isSelf: false, ws: "ws-history" }));

    expect(judgment.deferred).toBe(false);
    expect(judgment.noteworthy?.band).toBe("publish");
  });

  it("case g: history_30d sends the kind and time of the recent changes of the entity to Jev", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "pricing");
    await seedHistory("rival", 3);
    const oldSeenAt = new Date(Date.now() - 40 * 24 * 3_600_000).toISOString();
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, summary, aspect, url, dedup_key, observed_at, last_seen_at)
       VALUES ('sig-rival-old', 'ws-mine', 'rival', 'src_site_web', 'change', 'old change', 'home', 'https://rival.example/', 'dedup-rival-old', ?, ?)`,
    )
      .bind(oldSeenAt, oldSeenAt)
      .run();

    await judgeChange(judgeInput({ entity: "rival", isSelf: false }));

    const sent = jevAnswers.states[0] as { history_30d: { kind: string | null; at: string }[] };
    expect(sent.history_30d).toEqual([
      { kind: "home", at: NOW },
      { kind: "home", at: NOW },
      { kind: "home", at: NOW },
    ]);
  });

  it("case g2: history_30d leaves out signals that are not changes", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "pricing");
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, aspect, url, dedup_key, observed_at, last_seen_at)
       VALUES ('sig-post', 'ws-mine', 'rival', 'src_site_web', 'content', 'a post', 'blog', 'https://rival.example/', 'dedup-post', ?, ?)`,
    )
      .bind(NOW, NOW)
      .run();

    await judgeChange(judgeInput({ entity: "rival", isSelf: false }));

    const sent = jevAnswers.states[0] as { history_30d: unknown[] };
    expect(sent.history_30d).toEqual([]);
  });

  it("case h: Jev unavailable defers without writing verdicts", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "pricing");
    jevFailures.next = 1;

    const judgment = await judgeChange(judgeInput({ entity: "rival", isSelf: false }));

    expect(judgment.deferred).toBe(true);
    expect(judgment.noteworthy).toBeNull();
    expect(await rowsFor("rival")).toEqual([]);
  });

  it("case h2: a Jev outage during a site judgment is logged", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "pricing");
    jevFailures.next = 1;
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await judgeChange(judgeInput({ entity: "rival", isSelf: false }));

    const events = logged.mock.calls.map(([line]) => JSON.parse(String(line)).event);
    logged.mockRestore();
    expect(events).toContain("site.jev_unavailable");
  });

  it("case h3: a rate-limited Jev call throws so the workflow step can retry", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "pricing");
    jevFailures.next = 1;
    jevFailures.message = "2003: Rate limited";

    await expect(judgeChange(judgeInput({ entity: "rival", isSelf: false }))).rejects.toThrow(JevRateLimitedError);
    expect(await rowsFor("rival")).toEqual([]);
  });

  it("case i: Jev unavailable for the self breakage question defers too", async () => {
    jevAnswers.noul.set("own_site_breakage", 0.7);
    jevFailures.next = 1;

    const judgment = await judgeChange(judgeInput({ entity: "mine", isSelf: true }));

    expect(judgment).toEqual({ deferred: true, selfBreakage: null, noteworthy: null, verdictIds: [] });
    expect(await rowsFor("mine")).toEqual([]);
  });

  it("case j: each logged verdict carries the input hash the client returned", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.89);
    jevAnswers.choice.set("change_kind", "launch");

    const judgment = await judgeChange(judgeInput({ entity: "rival", isSelf: false }));

    expect(judgment.noteworthy).toEqual({ p: 0.89, kind: "launch", band: "uncertain" });
    const rows = await env.DB.prepare(
      "SELECT question_id, input_hash FROM jev_verdict WHERE entity_id = ? ORDER BY question_id",
    )
      .bind("rival")
      .all<{ question_id: string; input_hash: string }>();
    expect(rows.results).toEqual([
      { question_id: "change_kind", input_hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
      { question_id: "noteworthy_change", input_hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
  });

  it("does not rejudge a filed change when the brand already used today's judgment budget", async () => {
    for (let index = 0; index < 6; index += 1) {
      await insertVerdict({
        workspaceId: "ws-mine",
        questionId: index % 2 === 0 ? "noteworthy_change" : "change_kind",
        inputHash: `seeded-cap-${index}`,
        signalId: null,
        entityId: "rival",
        p: 0.9,
        choice: null,
        reason: null,
        decidedAt: NOW,
      }).run();
    }
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, url, payload_json, dedup_key, observed_at)
       VALUES ('sig-deferred', 'ws-mine', 'rival', 'src_site_web', 'change', 'home', 'https://rival.example/', '{}', 'dedup-deferred', ?)`,
    )
      .bind(NOW)
      .run();
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "copy");

    const judged = await rejudgeUnjudgedChanges({
      workspaceId: "ws-mine",
      windowStartAt: new Date(Date.parse(NOW) - 86_400_000).toISOString(),
      windowEndAt: new Date(Date.parse(NOW) + 86_400_000).toISOString(),
    });

    expect(judged).toBe(0);
    expect(jevAnswers.calls).toBe(0);
    expect(await rowsFor("rival")).toHaveLength(6);
  });

  it("links the verdicts of a rejudged change to its signal", async () => {
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, url, payload_json, dedup_key, observed_at)
       VALUES ('sig-linked', 'ws-mine', 'rival', 'src_site_web', 'change', 'home', 'https://rival.example/', '{}', 'dedup-linked', ?)`,
    )
      .bind(NOW)
      .run();
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "copy");

    const judged = await rejudgeUnjudgedChanges(todayWindow("ws-mine"));

    expect(judged).toBe(1);
    const linked = await env.DB.prepare(
      "SELECT signal_id FROM jev_verdict WHERE entity_id = ? AND question_id = 'noteworthy_change'",
    )
      .bind("rival")
      .first<{ signal_id: string | null }>();
    expect(linked?.signal_id).toBe("sig-linked");
  });

  it("keeps a self change unjudged when only a clear breakage verdict was stored, so it is rejudged later", async () => {
    await env.SNAPSHOTS.put("snapshot/site/c/before.txt", "Plans from $29 a month for teams with a named manager.");
    await env.SNAPSHOTS.put("snapshot/site/c/after.txt", "Plans from $39 a month for teams with a named manager.");
    const payload = {
      page: { role: "home", url: "https://mine.example/" },
      before: { snapshotId: "a", textKey: "snapshot/site/c/before.txt", screenshotKey: null },
      after: { snapshotId: "b", textKey: "snapshot/site/c/after.txt", screenshotKey: null },
      diffKey: null,
      wordsAdded: 1,
      wordsRemoved: 1,
      status: 200,
    };
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, url, payload_json, dedup_key, observed_at)
       VALUES ('sig-self-clear', 'ws-mine', 'mine', 'src_site_web', 'change', 'home', 'https://mine.example/', ?, 'dedup-self-clear', ?)`,
    )
      .bind(JSON.stringify(payload), NOW)
      .run();
    for (let index = 0; index < 6; index += 1) {
      await insertVerdict({
        workspaceId: "ws-mine",
        questionId: index % 2 === 0 ? "noteworthy_change" : "change_kind",
        inputHash: `self-cap-${index}`,
        signalId: null,
        entityId: "mine",
        p: 0.9,
        choice: null,
        reason: null,
        decidedAt: NOW,
      }).run();
    }
    jevAnswers.noul.set("own_site_breakage", 0.05);
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "copy");

    const first = await rejudgeUnjudgedChanges(todayWindow("ws-mine"));
    await env.DB.prepare("DELETE FROM jev_verdict WHERE input_hash LIKE 'self-cap-%'").run();
    const second = await rejudgeUnjudgedChanges(todayWindow("ws-mine"));

    expect(first).toBe(0);
    expect(second).toBe(1);
    const noteworthy = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM jev_verdict WHERE signal_id = 'sig-self-clear' AND question_id = 'noteworthy_change'",
    ).first<{ n: number }>();
    expect(noteworthy?.n).toBe(1);
  });

  it("does not spend the daily cap on rate-limited calls, so retries cannot exhaust it", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "copy");
    jevFailures.message = "2003: Rate limited";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      jevFailures.next = 2;
      await expect(judgeChange(judgeAt("rival", false, attempt))).rejects.toThrow(JevRateLimitedError);
    }
    jevFailures.next = 0;

    for (let index = 0; index < 3; index += 1) {
      expect((await judgeChange(judgeAt("rival", false, index))).deferred).toBe(false);
    }
    expect((await judgeChange(judgeAt("rival", false, 3))).deferred).toBe(true);
  });

  it("stops a rejudge batch at the first Jev refusal that is not a rate limit", async () => {
    await seedChangeSignals("rival", 3);
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "copy");
    jevFailures.next = 100;
    jevFailures.message = "5xxx: payment required";
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const judged = await rejudgeUnjudgedChanges(todayWindow("ws-mine"));

    const events = logged.mock.calls.map(([line]) => JSON.parse(String(line)).event);
    logged.mockRestore();
    expect(judged).toBe(0);
    expect(jevAnswers.calls).toBeLessThanOrEqual(2);
    expect(events).toContain("site.jev_unavailable");
  });

  it("leaves a self change unjudged and logs it when its stored snapshot is missing", async () => {
    const payload = {
      page: { role: "home", url: "https://mine.example/" },
      before: { snapshotId: "a", textKey: "snapshot/site/gone/before.txt", screenshotKey: null },
      after: { snapshotId: "b", textKey: "snapshot/site/gone/after.txt", screenshotKey: null },
      diffKey: null,
      wordsAdded: 0,
      wordsRemoved: 8,
      status: 200,
    };
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, url, payload_json, dedup_key, observed_at)
       VALUES ('sig-self-gone', 'ws-mine', 'mine', 'src_site_web', 'change', 'home', 'https://mine.example/', ?, 'dedup-self-gone', ?)`,
    )
      .bind(JSON.stringify(payload), NOW)
      .run();
    jevAnswers.noul.set("own_site_breakage", 0.8);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const judged = await rejudgeUnjudgedChanges(todayWindow("ws-mine"));

    expect(judged).toBe(0);
    expect(jevAnswers.calls).toBe(0);
    expect(await rowsFor("mine")).toEqual([]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("site.rejudge_snapshot_missing"));
    logged.mockRestore();
  });

  it("does not rejudge a self change whose payload has no stored page text", async () => {
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, url, payload_json, dedup_key, observed_at)
       VALUES ('sig-self-empty', 'ws-mine', 'mine', 'src_site_web', 'change', 'home', 'https://mine.example/', '{}', 'dedup-self-empty', ?)`,
    )
      .bind(NOW)
      .run();
    jevAnswers.noul.set("own_site_breakage", 0.8);

    const judged = await rejudgeUnjudgedChanges({
      workspaceId: "ws-mine",
      windowStartAt: new Date(Date.parse(NOW) - 86_400_000).toISOString(),
      windowEndAt: new Date(Date.parse(NOW) + 86_400_000).toISOString(),
    });

    expect(judged).toBe(0);
    expect(jevAnswers.calls).toBe(0);
    expect(await rowsFor("mine")).toEqual([]);
  });

  it("rejudges a self change from the stored snapshot text, not an empty page", async () => {
    await env.SNAPSHOTS.put("snapshot/site/w/before.txt", "Plans from $29 a month for teams with a named manager.");
    await env.SNAPSHOTS.put("snapshot/site/w/after.txt", "Error");
    const payload = {
      page: { role: "home", url: "https://mine.example/" },
      before: { snapshotId: "a", textKey: "snapshot/site/w/before.txt", screenshotKey: null },
      after: { snapshotId: "b", textKey: "snapshot/site/w/after.txt", screenshotKey: null },
      diffKey: null,
      wordsAdded: 0,
      wordsRemoved: 8,
      status: 503,
    };
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, url, payload_json, dedup_key, observed_at)
       VALUES ('sig-self-stored', 'ws-mine', 'mine', 'src_site_web', 'change', 'home', 'https://mine.example/', ?, 'dedup-self-stored', ?)`,
    )
      .bind(JSON.stringify(payload), NOW)
      .run();
    jevAnswers.noul.set("own_site_breakage", 0.8);

    const judged = await rejudgeUnjudgedChanges({
      workspaceId: "ws-mine",
      windowStartAt: new Date(Date.parse(NOW) - 86_400_000).toISOString(),
      windowEndAt: new Date(Date.parse(NOW) + 86_400_000).toISOString(),
    });

    expect(judged).toBe(1);
    expect(await rowsFor("mine")).toEqual([
      { question_id: "own_site_breakage", p: 0.8, choice: null, entity_id: "mine", reason: null },
    ]);
    expect(jevAnswers.states[0]).toEqual(
      expect.objectContaining({
        item: expect.objectContaining({
          evidence: expect.objectContaining({ status: 503, httpError: true }),
        }),
      }),
    );
  });
});

describe("computeBreakageEvidence", () => {
  it("flags http errors, halved text and vanished prices together", () => {
    const evidence = computeBreakageEvidence({
      status: 503,
      beforeText: "Pro plan £40 a month for teams",
      afterText: "Error",
    });
    expect(evidence.httpError).toBe(true);
    expect(evidence.textHalved).toBe(true);
    expect(evidence.pricesVanished).toBe(true);
  });

  it("counts price tokens and leaves a healthy page unflagged", () => {
    const beforeText = "Plans from $10 and €20 and ₹30 and more text to keep it long enough for a homepage";
    const evidence = computeBreakageEvidence({
      status: 200,
      beforeText,
      afterText: `${beforeText} Now with a new line of marketing copy.`,
    });
    expect(evidence.pricesBefore).toBe(3);
    expect(evidence.pricesAfter).toBe(3);
    expect(evidence.httpError).toBe(false);
    expect(evidence.textHalved).toBe(false);
    expect(evidence.pricesVanished).toBe(false);
  });
});
