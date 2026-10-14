import { env } from "cloudflare:test";
import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { readSiteChanges } from "../../app/lib/data/signal.server";
import { recordChangeFeedback } from "../../app/lib/data/user_decision.server";
import { onboardedContext } from "../../app/lib/require-onboarded.server";
import { action } from "../../app/routes/app.change-feedback";

const AT = "2026-10-10T10:00:00.000Z";
const SINCE = "2026-10-01T00:00:00.000Z";
const PAYLOAD = JSON.stringify({ page: { url: "https://a.example/pricing", role: "pricing" } });

const seedWorkspace = (ws: string, user: string, entity: string, signal: string) => [
  env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'T', ?2, 1, ?3, ?3)`,
  ).bind(user, `${user}@example.test`, AT),
  env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, 'T', ?2, 'UTC', ?3)`,
  ).bind(ws, user, AT),
  env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
     VALUES (?1, ?2, 'competitor', ?3, 'Brand', 'on', ?4)`,
  ).bind(entity, ws, `${entity}.example`, AT),
  env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, aspect, payload_json, dedup_key, observed_at)
     VALUES (?1, ?2, ?3, 'src-feedback', 'change', 'Change', 'https://a.example/pricing', 'copy', ?4, ?5, ?6)`,
  ).bind(signal, ws, entity, PAYLOAD, `dedup-${signal}`, AT),
];

const feedbackOf = async (ws: string, entity: string) =>
  (await readSiteChanges({ workspaceId: ws, entityId: entity, since: SINCE, limit: 10 })).map((row) => row.feedback);

describe("feedback on a change", () => {
  beforeEach(async () => {
    for (const table of ["user_decision", "signal", "entity", "workspace"]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.exec(`DELETE FROM source WHERE id = 'src-feedback'`);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
         VALUES ('src-feedback', 'key-feedback', 'site', 'web', 'plugin-feedback', 'scraped_page')`,
      ),
      ...seedWorkspace("ws-fb", "user-fb", "ent-fb", "sig-fb"),
      ...seedWorkspace("ws-fb2", "user-fb2", "ent-fb2", "sig-fb2"),
    ]);
  });

  it("reads as no answer until the customer gives one", async () => {
    expect(await feedbackOf("ws-fb", "ent-fb")).toEqual([null]);
  });

  it("keeps the latest answer only, one row per change", async () => {
    const base = { workspaceId: "ws-fb", userId: "user-fb", signalId: "sig-fb" };
    await recordChangeFeedback({ ...base, useful: true, decidedAt: AT });
    expect(await feedbackOf("ws-fb", "ent-fb")).toEqual(["change_feedback:useful"]);
    await recordChangeFeedback({ ...base, useful: false, decidedAt: "2026-10-11T10:00:00.000Z" });
    expect(await feedbackOf("ws-fb", "ent-fb")).toEqual(["change_feedback:not_useful"]);
    const rows = await env.DB.prepare(`SELECT COUNT(*) AS n FROM user_decision WHERE signal_id = 'sig-fb'`).first<{
      n: number;
    }>();
    expect(rows?.n).toBe(1);
  });

  it("ignores a decision whose verdict only resembles a feedback answer", async () => {
    await env.DB.prepare(
      `INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at)
       VALUES ('ud-odd', 'ws-fb', 'user-fb', 'sig-fb', 'ent-fb', 'change_feedback:maybe', NULL, ?1)`,
    )
      .bind(AT)
      .run();
    expect(await feedbackOf("ws-fb", "ent-fb")).toEqual([null]);
  });

  it("refuses a change that belongs to another workspace", async () => {
    await recordChangeFeedback({
      workspaceId: "ws-fb",
      userId: "user-fb",
      signalId: "sig-fb2",
      useful: true,
      decidedAt: AT,
    });
    expect(await feedbackOf("ws-fb2", "ent-fb2")).toEqual([null]);
    const rows = await env.DB.prepare(`SELECT COUNT(*) AS n FROM user_decision`).first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("goes away with the change", async () => {
    await recordChangeFeedback({
      workspaceId: "ws-fb",
      userId: "user-fb",
      signalId: "sig-fb",
      useful: true,
      decidedAt: AT,
    });
    await env.DB.exec(`DELETE FROM signal WHERE id = 'sig-fb'`);
    const rows = await env.DB.prepare(`SELECT COUNT(*) AS n FROM user_decision`).first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });
});

const post = (fields: Record<string, string>, referer: string | null) => {
  const context = new RouterContextProvider();
  context.set(onboardedContext, {
    session: { user: { id: "user-fb", email: "user-fb@example.test" } },
    workspaceId: "ws-fb",
  } as never);
  const request = new Request("https://0509.io/app/changes/feedback", {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: referer === null ? {} : { referer },
  });
  return action({ request, params: {}, context } as unknown as Parameters<typeof action>[0]);
};

describe("the feedback route", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM user_decision");
    await env.DB.exec("DELETE FROM signal");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.exec(`DELETE FROM source WHERE id = 'src-feedback'`);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
         VALUES ('src-feedback', 'key-feedback', 'site', 'web', 'plugin-feedback', 'scraped_page')`,
      ),
      ...seedWorkspace("ws-fb", "user-fb", "ent-fb", "sig-fb"),
    ]);
  });

  it("saves the answer and sends the customer back to the page they were on, at that change", async () => {
    const response = await post({ signalId: "sig-fb", value: "useful" }, "https://0509.io/app/alerts?kind=site");
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/app/alerts?kind=site#sig-fb");
    expect(await feedbackOf("ws-fb", "ent-fb")).toEqual(["change_feedback:useful"]);
  });

  it("saves the answer and falls back to Alerts when the Referer is not a URL", async () => {
    const response = await post({ signalId: "sig-fb", value: "useful" }, "not a url");
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/app/alerts#sig-fb");
    expect(await feedbackOf("ws-fb", "ent-fb")).toEqual(["change_feedback:useful"]);
  });

  it("never redirects off the site, and ignores a bad answer", async () => {
    const away = await post({ signalId: "sig-fb", value: "not_useful" }, "https://evil.example/app/x");
    expect(away.headers.get("Location")).toBe("/app/alerts");
    const bad = await post({ signalId: "sig-fb", value: "maybe" }, null);
    expect(bad.headers.get("Location")).toBe("/app/alerts");
    expect(await feedbackOf("ws-fb", "ent-fb")).toEqual(["change_feedback:not_useful"]);
  });
});
