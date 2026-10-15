import { env } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rejudgeUnjudgedChanges } from "../../../app/lib/site/judge.server";

const NOW = new Date().toISOString();
const HOUR_MS = 3_600_000;
const WINDOW = {
  workspaceId: "ws-late",
  windowStartAt: new Date(Date.parse(NOW) - 10 * 24 * HOUR_MS).toISOString(),
  windowEndAt: new Date(Date.parse(NOW) + HOUR_MS).toISOString(),
};

let breakageP = 0.8;
let jevDown = false;
let send: ReturnType<typeof vi.spyOn>;

function installJev(): void {
  Reflect.set(env, "AI", {
    async run(_model: string, request: { questions: Record<string, { type: string }> }) {
      if (jevDown) throw new Error("gateway down");
      const answers: Record<string, { type: "noul"; noul: number } | { type: "choice"; choice: string }> = {};
      for (const [id, question] of Object.entries(request.questions)) {
        answers[id] =
          question.type === "noul"
            ? { type: "noul", noul: id === "own_site_breakage" ? breakageP : 0.95 }
            : { type: "choice", choice: "copy" };
      }
      return { answers };
    },
  });
}

async function seedPlainChange(observedAt: string): Promise<void> {
  await env.SNAPSHOTS.put("snapshot/site/late/before.txt", "Plans from $29 a month for teams with a named manager.");
  await env.SNAPSHOTS.put("snapshot/site/late/after.txt", "Error");
  const payload = {
    page: { role: "home", url: "https://late-brand.com/" },
    before: { snapshotId: "a", textKey: "snapshot/site/late/before.txt", screenshotKey: null },
    after: { snapshotId: "b", textKey: "snapshot/site/late/after.txt", screenshotKey: null },
    diffKey: null,
    wordsAdded: 0,
    wordsRemoved: 8,
    status: 503,
  };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('user-late', 'Owner', 'late@0509.io', 1, ?1, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES ('ws-late', 'late', 'user-late', 'UTC', 1, 8, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES ('ent-late', 'ws-late', 'self', 'late-brand.com', 'Late', 'on', ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES ('page-late', 'ent-late', 'https://late-brand.com/', 'home', ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT INTO watch (id, entity_id, source_id, target_key, is_active) VALUES ('watch-late', 'ent-late', 'src_site_web', 'https://late-brand.com/', 1)`,
    ),
    env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, watch_id, kind, aspect, url, payload_json, dedup_key, observed_at)
       VALUES ('sig-late', 'ws-late', 'ent-late', 'src_site_web', 'watch-late', 'change', 'home', 'https://late-brand.com/', ?1, 'dedup-late', ?2)`,
    ).bind(JSON.stringify(payload), observedAt),
  ]);
}

async function incidents(): Promise<{ n: number }> {
  return (
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM incident WHERE page_id = 'page-late'").first<{ n: number }>()) ?? {
      n: 0,
    }
  );
}

async function alertSeverities(): Promise<string[]> {
  const rows = await env.DB.prepare("SELECT severity FROM alert WHERE workspace_id = 'ws-late' ORDER BY id").all<{
    severity: string;
  }>();
  return rows.results.map((row) => row.severity);
}

describe("a breakage judged after the sweep (0509#7337)", () => {
  beforeEach(async () => {
    for (const table of ["alert", "incident", "signal", "watch", "page", "entity", "workspace", '"user"']) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec("DELETE FROM jev_verdict");
    breakageP = 0.8;
    jevDown = false;
    installJev();
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    send = vi.spyOn(workerEnv.SEND_EMAIL, "send").mockResolvedValue({
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    });
  });

  afterEach(() => {
    send.mockRestore();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(env, "AI");
  });

  it("opens the incident and sends the email when Jev was down at the sweep and answers on the rejudge", async () => {
    await seedPlainChange(NOW);
    jevDown = true;
    expect(await rejudgeUnjudgedChanges(WINDOW)).toBe(0);
    expect(await incidents()).toEqual({ n: 0 });
    expect(send).not.toHaveBeenCalled();

    jevDown = false;
    expect(await rejudgeUnjudgedChanges(WINDOW)).toBe(1);

    expect(await incidents()).toEqual({ n: 1 });
    expect(await alertSeverities()).toEqual(["high"]);
    const signal = await env.DB.prepare("SELECT aspect FROM signal WHERE id = 'sig-late'").first<{ aspect: string }>();
    expect(signal?.aspect).toBe("breakage");
    const incident = await env.DB.prepare("SELECT id FROM incident WHERE page_id = 'page-late'").first<{
      id: string;
    }>();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ incident_id: incident?.id });
  });

  it("opens nothing when a fresh read of the page shows it has recovered", async () => {
    await seedPlainChange(NOW);
    vi.stubGlobal("fetch", (input: RequestInfo | URL) =>
      Promise.resolve(
        String(input instanceof Request ? input.url : input).endsWith("/robots.txt")
          ? new Response("", { status: 404 })
          : new Response("<html><body><p>Plans from $29 a month for teams with a named manager.</p></body></html>"),
      ),
    );

    expect(await rejudgeUnjudgedChanges(WINDOW)).toBe(1);

    expect(await incidents()).toEqual({ n: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("opens an in-app incident without an email for the check band, as the sweep path does", async () => {
    await seedPlainChange(NOW);
    breakageP = 0.3;

    expect(await rejudgeUnjudgedChanges(WINDOW)).toBe(1);

    expect(await incidents()).toEqual({ n: 1 });
    expect(await alertSeverities()).toEqual(["normal"]);
    expect(send).not.toHaveBeenCalled();
  });

  it("opens nothing for a page rated clear", async () => {
    await seedPlainChange(NOW);
    breakageP = 0.02;

    expect(await rejudgeUnjudgedChanges(WINDOW)).toBe(1);

    expect(await incidents()).toEqual({ n: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not email a second time when the page already has an open incident", async () => {
    await seedPlainChange(NOW);
    await env.DB.prepare(
      `INSERT INTO incident (id, workspace_id, entity_id, page_id, kind, opened_at) VALUES ('inc-open', 'ws-late', 'ent-late', 'page-late', 'breakage', ?1)`,
    )
      .bind(NOW)
      .run();

    expect(await rejudgeUnjudgedChanges(WINDOW)).toBe(1);

    expect(await incidents()).toEqual({ n: 1 });
    expect(await alertSeverities()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not announce a break that is more than two days old", async () => {
    await seedPlainChange(new Date(Date.parse(NOW) - 49 * HOUR_MS).toISOString());

    expect(await rejudgeUnjudgedChanges(WINDOW)).toBe(1);

    expect(await incidents()).toEqual({ n: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
