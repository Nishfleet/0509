import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { readCompetitorPage } from "../../app/lib/competitor-page.server";
import { readHomeReads } from "../../app/lib/home-page.server";
import { readHomeStandingInputs } from "../../app/lib/home-standing.server";

let runs = 0;

async function seed(rivals: number) {
  runs += 1;
  const ws = `ws_qc_${String(runs)}`;
  const user = `user_qc_${String(runs)}`;
  const at = "2026-10-05T00:00:00.000Z";
  const stmts = [
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'q', ?2, 1, ?3, ?3)",
    ).bind(user, `${user}@example.test`, at),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'q', ?2, 'UTC', 1, 8, ?3)",
    ).bind(ws, user, at),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'self', 'own.example', 'self', 'on', ?3)",
    ).bind(`${ws}_self`, ws, at),
  ];
  for (let i = 0; i < rivals; i += 1) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, 'on', ?5)",
      ).bind(`${ws}_r${String(i)}`, ws, `r${String(i)}.example`, `r${String(i)}`, at),
    );
    stmts.push(
      env.DB.prepare(
        "INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, computed_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?4)",
      ).bind(`${ws}_s${String(i)}`, ws, `${ws}_r${String(i)}`, at, i + 1),
    );
  }
  await env.DB.batch(stmts);
  return { ws, user };
}

async function count(fn: () => Promise<unknown>): Promise<number> {
  const db = env.DB as unknown as { prepare: (sql: string) => unknown };
  const original = db.prepare.bind(db);
  let n = 0;
  db.prepare = (sql: string) => {
    n += 1;
    return original(sql);
  };
  try {
    await fn();
  } finally {
    db.prepare = original;
  }
  return n;
}

describe("loader query counts", () => {
  it("Home and the competitor page prepare the same number of statements for 2 rivals as for 40", async () => {
    const counts: Record<"home" | "competitor", number[]> = { home: [], competitor: [] };
    for (const rivals of [2, 40]) {
      const { ws, user } = await seed(rivals);
      counts.home.push(
        await count(async () => {
          const inputs = await readHomeStandingInputs(user, ws);
          await readHomeReads(ws, inputs?.payload ?? null, null);
        }),
      );
      counts.competitor.push(
        await count(() => readCompetitorPage(ws, `${ws}_r0`, new Date("2026-10-12T00:00:00.000Z"))),
      );
    }
    expect(counts.home[1]).toBe(counts.home[0]);
    expect(counts.competitor[1]).toBe(counts.competitor[0]);
    expect(counts.home[1]).toBeLessThanOrEqual(10);
    expect(counts.competitor[1]).toBeLessThanOrEqual(15);
  });
});
