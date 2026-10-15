import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { countVerdictsSince, readVerdictIds, type VerdictRow } from "../../../app/lib/data/jev_verdict.server";

const NOW = "2026-09-24T00:00:00Z";
const AT_IN_RANGE = "2026-09-22T10:00:00Z";
const AT_TOO_EARLY = "2026-09-01T10:00:00Z";

function insertVerdict(id: string, questionId: string, inputHash: string, decidedAt: string) {
  return env.DB.prepare(
    `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, entity_id, p, choice, decided_at)
     VALUES (?, 'ws-a', ?, ?, 'e-a', 0.4, 'yes', ?)`,
  ).bind(id, questionId, inputHash, decidedAt);
}

function verdictRow(inputHash: string): VerdictRow {
  return {
    workspaceId: "ws-a",
    questionId: "still_competitor_reason",
    inputHash,
    signalId: null,
    entityId: "e-a",
    p: 0.4,
    choice: "yes",
    reason: null,
    decidedAt: AT_IN_RANGE,
  };
}

beforeEach(async () => {
  for (const table of ["jev_verdict", "entity", "workspace", '"user"']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('user-ws-a', 'Owner', 'ws-a@0509.io', 0, ?, ?)`,
  )
    .bind(NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES ('ws-a', 'Owner', 'user-ws-a', ?)`,
  )
    .bind(NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, state, created_at) VALUES ('e-a', 'ws-a', 'competitor', 'comp.example', 'on', ?)`,
  )
    .bind(NOW)
    .run();
});

describe("countVerdictsSince", () => {
  it("counts only the entity's verdicts in the asked questions since the timestamp", async () => {
    await insertVerdict("v-1", "still_competitor_reason", "hash-1", AT_IN_RANGE).run();
    await insertVerdict("v-2", "still_competitor_reason", "hash-2", AT_IN_RANGE).run();
    await insertVerdict("v-3", "other_question", "hash-3", AT_IN_RANGE).run();
    await insertVerdict("v-4", "still_competitor_reason", "hash-4", AT_TOO_EARLY).run();

    expect(await countVerdictsSince("e-a", AT_IN_RANGE, ["still_competitor_reason"])).toBe(2);
  });

  it("returns zero when the entity has no verdict in range", async () => {
    expect(await countVerdictsSince("e-a", AT_IN_RANGE, ["still_competitor_reason"])).toBe(0);
  });
});

describe("readVerdictIds", () => {
  it("returns the stored ids for the question and input hash pairs", async () => {
    await insertVerdict("v-1", "still_competitor_reason", "hash-1", AT_IN_RANGE).run();
    await insertVerdict("v-2", "still_competitor_reason", "hash-2", AT_IN_RANGE).run();

    const ids = await readVerdictIds([verdictRow("hash-1"), verdictRow("hash-2"), verdictRow("hash-missing")]);

    expect([...ids].sort()).toEqual(["v-1", "v-2"]);
  });

  it("returns an empty list when there is nothing to look up", async () => {
    expect(await readVerdictIds([])).toEqual([]);
  });
});
