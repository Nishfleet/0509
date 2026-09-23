import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  runCountStep,
  runGeneratorsStep,
  runJudgeStep,
  runKickSweepsStep,
  runResolveStep,
  runWriteStep,
} from "../../../workers/discovery-workflow";

// The pipeline steps run against real local D1/R2/KV in workerd; outbound
// fetch is stubbed per URL family so the whole create path is deterministic
// and CI-safe. Jev answers are inputs here — judge math has its own suite.

const NOW = "2026-09-23T12:00:00.000Z";
let seedN = 0;

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>news</title>
<item><title>Gymshark vs Alphalete: which gym brand wins 2026</title>
<link>https://fitness.example/versus</link><source url="https://fitness.example">Fitness Daily</source></item>
<item><title>Best Gymshark alternatives: Alphalete, Van Rykel, Zzzbrand</title>
<link>https://wear.example/roundup</link><source url="https://wear.example">Wear Weekly</source></item>
</channel></rss>`;

const HN_BODY = JSON.stringify({
  hits: [
    {
      objectID: "111",
      title: "Ask HN: Gymshark vs Alphalete for lifting gear?",
      url: "https://alphalete.com/",
      comment_text: null,
    },
  ],
});

const WIKIDATA_SEARCH = JSON.stringify({ search: [{ id: "Q999", label: "Alphalete" }] });
const WIKIDATA_ENTITIES = JSON.stringify({
  entities: {
    Q999: {
      claims: {
        P856: [{ mainsnak: { datavalue: { value: "https://alphalete.com" } } }],
      },
    },
  },
});
const JEV_ACCEPT = JSON.stringify({
  answers: {
    is_competitor: { type: "boolean", probability: 0.95, reason: "same market" },
    still_competitor: { type: "boolean", probability: 0.95 },
    reason: { type: "choice", choice: "active", probabilities: { active: 1 } },
  },
});
const JEV_ACQUIRED = JSON.stringify({
  answers: {
    still_competitor: { type: "boolean", probability: 0.05 },
    reason: { type: "choice", choice: "acquired", probabilities: { acquired: 0.9 } },
  },
});

function stubFetch(jevBody: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("news.google.com/rss")) return new Response(RSS);
    if (url.includes("hn.algolia.com")) return new Response(HN_BODY);
    if (url.includes("wikidata.org") && url.includes("wbsearchentities")) {
      return new Response(url.includes("Alphalete") ? WIKIDATA_SEARCH : JSON.stringify({}));
    }
    if (url.includes("wikidata.org") && url.includes("wbgetentities")) {
      return new Response(WIKIDATA_ENTITIES);
    }
    if (url.includes("jev.test")) return new Response(jevBody);
    if (url.startsWith("https://alphalete.com")) return new Response("<html><body>ok</body></html>");
    if (url.startsWith("https://fitness.example") || url.startsWith("https://wear.example")) {
      return new Response("<html><body><h2>Alphalete</h2><h2>Van Rykel</h2></body></html>");
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function stubQueue(sent: { queue: string; watchId: string }[], name: string) {
  return {
    send: async (body: { watchId: string }) => {
      sent.push({ queue: name, watchId: body.watchId });
    },
    sendBatch: async (batch: { body: { watchId: string } }[]) => {
      for (const item of batch) sent.push({ queue: name, watchId: item.body.watchId });
    },
  };
}

function testEnv(sent: { queue: string; watchId: string }[], jevBody = JEV_ACCEPT) {
  return {
    DB: env.DB,
    CARD_ARTIFACTS: env.CARD_ARTIFACTS,
    RESOLVE_CACHE: env.RESOLVE_CACHE,
    FETCH_SWEEP: stubQueue(sent, "fetch-sweep"),
    PAGE_SWEEP: stubQueue(sent, "page-sweep"),
    JEV_ENDPOINT: "https://jev.test/",
    JEV_KEY: "test",
    fetchImpl: stubFetch(jevBody),
  } as never;
}

async function seedWorkspace() {
  seedN += 1;
  const userId = `u_wf_${seedN}`;
  const workspaceId = `ws_wf_${seedN}`;
  const selfId = `ent_self_wf_${seedN}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
    ).bind(userId, "Test", `wf-${seedN}@example.test`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(workspaceId, "Workflow Test", userId, "UTC", NOW),
    env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
       VALUES (?1, ?2, 'self', 'gymshark.com', 'Gymshark', ?3, 'manual', 'on', ?4)`,
    ).bind(selfId, workspaceId, JSON.stringify({ category: "DTC gym apparel", country: "GB" }), NOW),
    env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
       VALUES (?1, ?2, 'mentions', 'rss', ?2, 'rss', 1, '{}')`,
    ).bind(`src_wf_fetch_${seedN}`, `wf.mentions_${seedN}`),
    env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
       VALUES (?1, ?2, 'ads', 'meta', ?2, 'scraped_page', 1, '{"transport":"browser"}')`,
    ).bind(`src_wf_ads_${seedN}`, `wf.ads_${seedN}`),
  ]);
  return { workspaceId, selfId };
}

async function runCreatePipeline(workspaceId: string, runId: string) {
  const sent: { queue: string; watchId: string }[] = [];
  const testEnvValue = testEnv(sent);
  const generated = await runGeneratorsStep(testEnvValue, workspaceId, runId);
  expect(generated.candidatesKey).not.toBeNull();
  const counted = await runCountStep(testEnvValue, generated.candidatesKey as string);
  const resolved = await runResolveStep(testEnvValue, counted.shortlistKey);
  const judged = await runJudgeStep(
    testEnvValue,
    workspaceId,
    "create",
    counted.shortlistKey,
    resolved.resolutionsKey,
    `discovery/${workspaceId}/${runId}`,
  );
  const written = await runWriteStep(
    testEnvValue,
    workspaceId,
    counted.shortlistKey,
    judged.judgedKey,
    judged.refreshedKey,
  );
  const kicked = await runKickSweepsStep(
    testEnvValue,
    workspaceId,
    written.acceptedIds,
    "2026-09-23",
  );
  return { generated, counted, resolved, judged, written, kicked, sent };
}

describe("discovery workflow steps against real D1/R2/KV", () => {
  it("cold create run: generators to queue kick on real rows", async () => {
    const { workspaceId, selfId } = await seedWorkspace();
    const out = await runCreatePipeline(workspaceId, "run-a");

    expect(out.generated.candidateCount).toBeGreaterThan(0);
    expect(out.written.accepted).toContain("alphalete.com");

    const entity = await env.DB.prepare(
      "SELECT id, origin, state FROM entity WHERE workspace_id = ? AND domain = 'alphalete.com'",
    )
      .bind(workspaceId)
      .first<{ id: string; origin: string; state: string }>();
    expect(entity).toMatchObject({ origin: "auto", state: "on" });

    const suggestion = await env.DB.prepare(
      `SELECT status, verdict_p, decided_by FROM suggestion
       WHERE workspace_id = ? AND candidate_domain = 'alphalete.com'`,
    )
      .bind(workspaceId)
      .first<{ status: string; verdict_p: number; decided_by: string }>();
    expect(suggestion).toMatchObject({ status: "auto_on", decided_by: "jev" });
    expect(suggestion?.verdict_p).toBeCloseTo(0.95);

    const verdict = await env.DB.prepare(
      `SELECT id, question_id, p FROM jev_verdict
       WHERE workspace_id = ? AND question_id = 'd1.is_competitor'`,
    )
      .bind(workspaceId)
      .first<{ id: string; p: number }>();
    expect(verdict?.id).toMatch(/^jev_/);
    expect(verdict?.p).toBeCloseTo(0.95);

    const snapshots = await env.DB.prepare(
      `SELECT s.item_count, s.payload_r2_key FROM snapshot s
       JOIN watch w ON w.id = s.watch_id
       WHERE w.entity_id = ? AND s.payload_r2_key IS NOT NULL`,
    )
      .bind(selfId)
      .all<{ item_count: number; payload_r2_key: string }>();
    expect(snapshots.results.length).toBeGreaterThanOrEqual(2);
    for (const snap of snapshots.results) {
      const object = await env.CARD_ARTIFACTS.get(snap.payload_r2_key);
      expect(object, `payload ${snap.payload_r2_key} must exist in R2`).not.toBeNull();
    }

    const watches = await env.DB.prepare(
      `SELECT w.id FROM watch w JOIN source s ON s.id = w.source_id
       WHERE w.entity_id = ? AND s.key NOT LIKE 'discovery.%'`,
    )
      .bind(entity?.id ?? "")
      .all<{ id: string }>();
    expect(watches.results.length).toBe(2);
    expect(out.kicked.fetch).toBe(1);
    expect(out.kicked.page).toBe(1);
    expect(out.sent.map((m) => m.queue).sort()).toEqual(["fetch-sweep", "page-sweep"]);
  });

  it("a dismissed suggestion stays dismissed when the pipeline re-runs", async () => {
    const { workspaceId } = await seedWorkspace();
    await runCreatePipeline(workspaceId, "run-b1");
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE suggestion SET status = 'dismissed', decided_by = 'user'
         WHERE workspace_id = ? AND candidate_domain = 'alphalete.com'`,
      ).bind(workspaceId),
      env.DB.prepare(
        "DELETE FROM entity WHERE workspace_id = ? AND domain = 'alphalete.com'",
      ).bind(workspaceId),
    ]);

    const out = await runCreatePipeline(workspaceId, "run-b2");
    expect(out.written.accepted).not.toContain("alphalete.com");
    const suggestion = await env.DB.prepare(
      `SELECT status, decided_by FROM suggestion
       WHERE workspace_id = ? AND candidate_domain = 'alphalete.com'`,
    )
      .bind(workspaceId)
      .first<{ status: string; decided_by: string }>();
    expect(suggestion).toMatchObject({ status: "dismissed", decided_by: "user" });
    const entity = await env.DB.prepare(
      "SELECT id FROM entity WHERE workspace_id = ? AND domain = 'alphalete.com'",
    )
      .bind(workspaceId)
      .first();
    expect(entity).toBeNull();
  });

  it("refresh mode retires an acquired auto competitor but never a manual one", async () => {
    const { workspaceId } = await seedWorkspace();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, origin, state, created_at)
         VALUES (?1, ?2, 'competitor', 'deadbrand.example', 'DeadBrand', 'auto', 'on', ?3)`,
      ).bind(`ent_dead_${seedN}`, workspaceId, NOW),
      env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, origin, state, created_at)
         VALUES (?1, ?2, 'competitor', 'rival.example', 'Rival', 'manual', 'on', ?3)`,
      ).bind(`ent_rival_${seedN}`, workspaceId, NOW),
    ]);

    const sent: { queue: string; watchId: string }[] = [];
    const prefix = `discovery/${workspaceId}/run-c`;
    await env.CARD_ARTIFACTS.put(`${prefix}/shortlist.json`, "[]");
    await env.CARD_ARTIFACTS.put(`${prefix}/resolutions.json`, "{}");
    const judged = await runJudgeStep(
      testEnv(sent, JEV_ACQUIRED),
      workspaceId,
      "refresh",
      `${prefix}/shortlist.json`,
      `${prefix}/resolutions.json`,
      prefix,
    );

    const d2Object = await env.CARD_ARTIFACTS.get(judged.refreshedKey as string);
    const outcomes = JSON.parse((await d2Object?.text()) ?? "[]") as {
      entityId: string;
      action: string;
      reason?: string;
    }[];
    expect(outcomes.find((o) => o.entityId === `ent_dead_${seedN}`)?.action).toBe("retire");
    expect(outcomes.find((o) => o.entityId === `ent_rival_${seedN}`)?.action).toBe("ask");
  });
});
