import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jevAnswers = vi.hoisted(() => ({
  noul: new Map<string, number>(),
  choice: new Map<string, string>(),
  calls: 0,
}));

const jevFailures = vi.hoisted(() => ({ next: 0 }));

vi.mock("../../../app/lib/jev/client.server", () => {
  class JevUnavailableError extends Error {
    constructor(cause: unknown) {
      super(`jev unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
      this.name = "JevUnavailableError";
    }
  }
  return {
    JevUnavailableError,
    askNoul: async (workspaceId: string, question: { id: string }) => {
      jevAnswers.calls += 1;
      if (jevFailures.next > 0) {
        jevFailures.next -= 1;
        throw new JevUnavailableError(new Error("gateway down"));
      }
      const p = jevAnswers.noul.get(question.id);
      if (p === undefined) throw new JevUnavailableError(new Error(`no answer for ${question.id}`));
      return { questionId: question.id, inputHash: `noul-${workspaceId}-${question.id}`, p, cached: false };
    },
    askChoice: async (workspaceId: string, question: { id: string }) => {
      jevAnswers.calls += 1;
      const choice = jevAnswers.choice.get(question.id);
      if (choice === undefined) throw new JevUnavailableError(new Error(`no answer for ${question.id}`));
      return { questionId: question.id, inputHash: `choice-${workspaceId}-${question.id}`, choice, cached: false };
    },
  };
});

import { computeBreakageEvidence } from "../../../app/lib/site/breakage-evidence";
import { judgeChange } from "../../../app/lib/site/judge.server";
import { insertVerdict } from "../../../app/lib/data/jev_verdict.server";

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
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, url, dedup_key, observed_at, last_seen_at)
       VALUES (?, 'ws-mine', ?, 'src_site_web', 'change', 'home', ?, ?, ?, ?)`,
    )
      .bind(`sig-${entity}-${index}`, entity, `https://${entity}.example/`, `dedup-${entity}-${index}`, NOW, NOW)
      .run();
  }
}

function judgeInput(input: { entity: string; isSelf: boolean; ws?: string; subjectName?: string }): Parameters<typeof judgeChange>[0] {
  return {
    workspaceId: input.ws ?? "ws-mine",
    entityId: input.entity,
    isSelf: input.isSelf,
    subject: { name: input.subjectName ?? "Rival", domain: `${input.entity}.example` },
    pageUrl: `https://${input.entity}.example/`,
    pageRole: "home",
    hunks: [{ lines: ["-Plans from $10", "+Plans from $12"] }],
    evidence: computeBreakageEvidence({ status: 200, beforeText: "Plans from $10.", afterText: "Plans from $12." }),
  };
}

async function rowsFor(entity: string): Promise<{ question_id: string; p: number | null; choice: string | null; entity_id: string | null; reason: string | null }[]> {
  const result = await env.DB.prepare(
    "SELECT question_id, p, choice, entity_id, reason FROM jev_verdict WHERE entity_id = ? ORDER BY question_id",
  )
    .bind(entity)
    .all<{ question_id: string; p: number | null; choice: string | null; entity_id: string | null; reason: string | null }>();
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
    jevFailures.next = 0;
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

  it("case a: a competitor change at 0.95 publishes with kind and two logged verdicts", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "pricing");
    await seedHistory("rival", 3);

    const judgment = await judgeChange(judgeInput({ entity: "rival", isSelf: false }));

    expect(judgment.deferred).toBe(false);
    expect(judgment.selfBreakage).toBeNull();
    expect(judgment.noteworthy).toEqual({ p: 0.95, kind: "pricing", band: "publish", reason: "publish at p=0.95" });
    expect(await rowsFor("rival")).toEqual([
      { question_id: "change_kind", p: null, choice: "pricing", entity_id: "rival", reason: "publish at p=0.95" },
      { question_id: "noteworthy_change", p: 0.95, choice: null, entity_id: "rival", reason: "publish at p=0.95" },
    ]);
  });

  it("case b: a competitor change at 0.5 stays uncertain", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.5);
    jevAnswers.choice.set("change_kind", "copy");

    const judgment = await judgeChange(judgeInput({ entity: "rival", isSelf: false }));

    expect(judgment.noteworthy).toEqual({ p: 0.5, kind: "copy", band: "uncertain", reason: "uncertain at p=0.5" });
    expect(await rowsFor("rival")).toHaveLength(2);
  });

  it("case c: a competitor change at 0.05 discards but still logs both verdicts", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.05);
    jevAnswers.choice.set("change_kind", "copy");

    const judgment = await judgeChange(judgeInput({ entity: "rival", isSelf: false }));

    expect(judgment.noteworthy).toEqual({ p: 0.05, kind: "copy", band: "discard", reason: "discard at p=0.05" });
    expect(await rowsFor("rival")).toEqual([
      { question_id: "change_kind", p: null, choice: "copy", entity_id: "rival", reason: "discard at p=0.05" },
      { question_id: "noteworthy_change", p: 0.05, choice: null, entity_id: "rival", reason: "discard at p=0.05" },
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
    expect(judgment.selfBreakage).toEqual({ p: 0.7, band: "alert", reason: "alert at p=0.7" });
    expect(judgment.noteworthy).toBeNull();
    expect(jevAnswers.calls).toBe(1);
    expect((await rowsFor("mine")).map((row) => row.question_id)).toEqual(["own_site_breakage"]);
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
    await judgeChange({ ...judgeInput({ entity: "rival", isSelf: false }), workspaceId: "ws-history", entityId: "dated" });

    expect(await rowsFor("rival")).toHaveLength(2);
    expect(await rowsFor("dated")).toHaveLength(2);
  });

  it("case f: an entity at budget defers without calling the client", async () => {
    for (let index = 0; index < 6; index += 1) {
      await insertVerdict({
        workspaceId: "ws-history",
        questionId: `seeded-${index}`,
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

    expect(judgment).toEqual({ deferred: true, selfBreakage: null, noteworthy: null });
    expect(jevAnswers.calls).toBe(0);
  });

  it("case f2: an entity outside the budget window does not use up budget", async () => {
    for (let index = 0; index < 6; index += 1) {
      await insertVerdict({
        workspaceId: "ws-history",
        questionId: `stale-${index}`,
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

  it("case g: over-budget deferral writes no verdicts", async () => {
    for (let index = 0; index < 6; index += 1) {
      await insertVerdict({
        workspaceId: "ws-history",
        questionId: `filled-${index}`,
        inputHash: `filled-${index}`,
        signalId: null,
        entityId: "over",
        p: 0.9,
        choice: null,
        reason: null,
        decidedAt: NOW,
      }).run();
    }

    expect(await judgeChange(judgeInput({ entity: "over", isSelf: false, ws: "ws-history" }))).toMatchObject({ deferred: true });
    expect(await rowsFor("over")).toHaveLength(6);
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

  it("case i: Jev unavailable for the self breakage question defers too", async () => {
    jevAnswers.noul.set("own_site_breakage", 0.7);
    jevFailures.next = 1;

    const judgment = await judgeChange(judgeInput({ entity: "mine", isSelf: true }));

    expect(judgment).toEqual({ deferred: true, selfBreakage: null, noteworthy: null });
    expect(await rowsFor("mine")).toEqual([]);
  });

  it("case j: each logged verdict carries the input hash the client returned", async () => {
    jevAnswers.noul.set("noteworthy_change", 0.89);
    jevAnswers.choice.set("change_kind", "launch");

    const judgment = await judgeChange(judgeInput({ entity: "rival", isSelf: false }));

    expect(judgment.noteworthy).toEqual({ p: 0.89, kind: "launch", band: "uncertain", reason: "uncertain at p=0.89" });
    const rows = await env.DB.prepare(
      "SELECT question_id, input_hash FROM jev_verdict WHERE entity_id = ? ORDER BY question_id",
    )
      .bind("rival")
      .all<{ question_id: string; input_hash: string }>();
    expect(rows.results).toEqual([
      { question_id: "change_kind", input_hash: "choice-ws-mine-change_kind" },
      { question_id: "noteworthy_change", input_hash: "noul-ws-mine-noteworthy_change" },
    ]);
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
