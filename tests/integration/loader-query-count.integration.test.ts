import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { loadAlertsPage } from "../../app/lib/alerts-page.server";
import { readCompetitorPage } from "../../app/lib/competitor-page.server";
import { listWorkspaceBriefs, readWorkspaceBrief } from "../../app/lib/data/digest.server";
import { readCompetitors } from "../../app/lib/data/entity.server";
import { readDeviceList } from "../../app/lib/devices.server";
import { readHomeReads } from "../../app/lib/home-page.server";
import { readHomeStandingInputs } from "../../app/lib/home-standing.server";
import { readSettings } from "../../app/lib/settings.server";

let runs = 0;

async function seed(rivals: number, weeks: number) {
  runs += 1;
  const ws = `ws_qc_${String(runs)}`;
  const user = `user_qc_${String(runs)}`;
  const at = "2026-10-05T00:00:00.000Z";
  const stmts = [
    env.DB.prepare(
      "INSERT OR IGNORE INTO source (id, key, kind, platform, plugin_key, reliability) VALUES ('src_qc', 'qc', 'mentions', 'gdelt', 'gdelt', 'best_effort')",
    ),
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
  const day = 24 * 60 * 60 * 1000;
  for (let w = 0; w < weeks; w += 1) {
    const start = new Date(Date.parse("2026-10-05T00:00:00.000Z") - w * 7 * day).toISOString();
    stmts.push(
      env.DB.prepare(
        "INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at) VALUES (?1, ?2, 'weekly', ?3, ?3, 'sent', 's', '{}', ?3)",
      ).bind(`${ws}_d${String(w)}`, ws, start),
    );
    for (let i = 0; i < rivals; i += 1) {
      for (const kind of ["mention", "hiring", "change"]) {
        stmts.push(
          env.DB.prepare(
            "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, aspect, canonical_url, url_hash, dedup_key, observed_at, published_at) VALUES (?1, ?2, ?3, 'src_qc', ?4, 't', 'price', 'https://e.example/x', ?1, ?1, ?5, ?5)",
          ).bind(`${ws}_g${String(w)}_${String(i)}_${kind}`, ws, `${ws}_r${String(i)}`, kind, start),
        );
      }
    }
  }
  for (let from = 0; from < stmts.length; from += 100) await env.DB.batch(stmts.slice(from, from + 100));
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

type Page = "home" | "competitor" | "alerts" | "brief" | "settings" | "competitors";

// measured 2026-10-14; raising one needs a reason in the PR
const BUDGET: Record<Page, number> = {
  home: 8,
  competitor: 13,
  alerts: 15,
  brief: 2,
  settings: 17,
  competitors: 4,
};

describe("loader query counts", () => {
  it("every signed-in page prepares the same number of statements for 2 rivals and 2 weeks as for 40 rivals and 26 weeks, within its budget", async () => {
    const counts = {} as Record<Page, number[]>;
    for (const page of Object.keys(BUDGET) as Page[]) counts[page] = [];
    for (const [rivals, weeks] of [
      [2, 2],
      [40, 26],
    ]) {
      const { ws, user } = await seed(rivals, weeks);
      const owner = { id: user, email: `${user}@example.test`, name: "q" } as Parameters<typeof readSettings>[0];
      const measured: Record<Page, () => Promise<unknown>> = {
        home: async () => {
          const inputs = await readHomeStandingInputs(user, ws);
          await readHomeReads(ws, inputs?.payload ?? null, null);
        },
        competitor: () => readCompetitorPage(ws, `${ws}_r0`, new Date("2026-10-12T00:00:00.000Z")),
        alerts: () => loadAlertsPage(ws, "all"),
        brief: async () => {
          const weeksList = await listWorkspaceBriefs(ws);
          await readWorkspaceBrief(ws, weeksList[0]?.id ?? "none");
        },
        settings: () => Promise.all([readSettings(owner), readDeviceList(user, "session")]),
        competitors: () => readCompetitors(ws),
      };
      for (const page of Object.keys(BUDGET) as Page[]) counts[page].push(await count(measured[page]));
    }
    for (const page of Object.keys(BUDGET) as Page[]) {
      expect(counts[page][1], `${page} at 40 rivals and 26 weeks`).toBe(counts[page][0]);
      expect(counts[page][1], `${page} budget`).toBeLessThanOrEqual(BUDGET[page]);
    }
  });
});
