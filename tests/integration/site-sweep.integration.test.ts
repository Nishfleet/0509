import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { openIncident, recordIncidentNotice } from "../../app/lib/data/incident.server";
import { insertSignal } from "../../app/lib/data/signal.server";
import {
  insertSnapshot,
  latestSnapshotForPage,
  readSnapshotPayload,
  snapshotPayloadKey,
  writeSnapshotPayload,
} from "../../app/lib/data/snapshot.server";
import { findVerdict, insertVerdict } from "../../app/lib/data/jev-verdict.server";
import { ensureSiteSource } from "../../app/lib/data/source.server";
import { listDueSiteWatches } from "../../app/lib/data/watch.server";
import { upsertPage } from "../../app/lib/data/page.server";
import { extractPage } from "../../app/lib/site/extract.server";
import { recordWatchFailure } from "../../app/lib/site/sweep.server";

async function seedBase() {
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)`,
  ).bind(userId, "Nish", `u-${userId}@example.com`, now, now).run();
  await env.DB.prepare(
    "INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)",
  ).bind(workspaceId, "ws", userId, now).run();
  return { userId, workspaceId };
}

async function seedEntity(
  workspaceId: string,
  role: "self" | "competitor",
  domain: string,
  state = "on",
) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, workspaceId, role, domain, domain, state, new Date().toISOString()).run();
  return id;
}

async function seedWatch(entityId: string, sourceId: string, target: string) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO watch (id, entity_id, source_id, target_key) VALUES (?, ?, ?, ?)",
  ).bind(id, entityId, sourceId, target).run();
  return id;
}

describe("site engine", () => {
  it("extractPage reads structured fields out of rendered HTML", async () => {
    const page = await extractPage(
      `<html><head><title>Gymshark</title><meta name="description" content="Gym clothes"></head>
       <body><h1>Lift the city</h1><span class="price">$42</span>
       <a class="btn" href="/shop">Shop now</a><a href="/pricing">Pricing</a>
       <script>var x = "noise"</script></body></html>`,
    );
    expect(page.title).toBe("Gymshark");
    expect(page.description).toBe("Gym clothes");
    expect(page.headings).toContain("Lift the city");
    expect(page.prices.join(" ")).toContain("$42");
    expect(page.links.map((l) => l.href)).toContain("/pricing");
    expect(page.text).not.toContain("noise");
  });

  it("keeps one snapshot row per tick with the body in R2", async () => {
    const { workspaceId } = await seedBase();
    const entityId = await seedEntity(workspaceId, "competitor", "gymshark.com");
    const source = await ensureSiteSource(env);
    const watchId = await seedWatch(entityId, source.id, "https://gymshark.com/");
    const page = await upsertPage(env, entityId, "https://gymshark.com/");
    const snapId = crypto.randomUUID();
    const key = snapshotPayloadKey(entityId, page.id, snapId);
    await writeSnapshotPayload(env, key, {
      url: page.url,
      fetched_at: new Date().toISOString(),
      text: "canonical text",
      fields: { title: "Gymshark" },
      html: "<html></html>",
      screenshot_key: null,
    });
    await insertSnapshot(env, {
      id: snapId,
      watch_id: watchId,
      page_id: page.id,
      payload_r2_key: key,
      payload_hash: "abc123",
      item_count: 3,
    });
    const latest = await latestSnapshotForPage(env, page.id);
    expect(latest?.id).toBe(snapId);
    expect(latest?.payload_hash).toBe("abc123");
    const payload = await readSnapshotPayload(env, key);
    expect(payload?.text).toBe("canonical text");
  });

  it("caches a verdict by question + input hash and never stores a second call", async () => {
    const { workspaceId } = await seedBase();
    await insertVerdict(env, {
      workspace_id: workspaceId,
      question_id: "noteworthy_change",
      input_hash: "h1",
      p: 0.95,
      choice: "pricing",
    });
    await insertVerdict(env, {
      workspace_id: workspaceId,
      question_id: "noteworthy_change",
      input_hash: "h1",
      p: 0.10,
      choice: "noise",
    });
    const found = await findVerdict(env, "noteworthy_change", "h1");
    expect(found?.p).toBe(0.95);
    const count = await env.DB.prepare(
      "SELECT count(*) AS n FROM jev_verdict WHERE question_id = 'noteworthy_change' AND input_hash = 'h1'",
    ).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("keeps one open incident per page and one notice per page per day", async () => {
    const { workspaceId } = await seedBase();
    const entityId = await seedEntity(workspaceId, "self", "0509.io");
    const page = await upsertPage(env, entityId, "https://0509.io/");
    const first = await openIncident(env, {
      workspace_id: workspaceId, entity_id: entityId, page_id: page.id, kind: "looks_broken",
    });
    const second = await openIncident(env, {
      workspace_id: workspaceId, entity_id: entityId, page_id: page.id, kind: "looks_broken",
    });
    expect(second.id).toBe(first.id);
    const notice = await recordIncidentNotice(env, {
      incident_id: first.id, page_id: page.id, is_resolution: false,
    });
    expect(notice).not.toBeNull();
    const dup = await recordIncidentNotice(env, {
      incident_id: first.id, page_id: page.id, is_resolution: false,
    });
    expect(dup).toBeNull();
  });

  it("collapses a re-seen change on UNIQUE(source_id, dedup_key)", async () => {
    const { workspaceId } = await seedBase();
    const entityId = await seedEntity(workspaceId, "competitor", "allbirds.com");
    const source = await ensureSiteSource(env);
    const watchId = await seedWatch(entityId, source.id, "https://allbirds.com/");
    const page = await upsertPage(env, entityId, "https://allbirds.com/pricing");
    const snapId = crypto.randomUUID();
    await insertSnapshot(env, {
      id: snapId, watch_id: watchId, page_id: page.id,
      payload_r2_key: "k", payload_hash: "h", item_count: 0,
    });
    const insert = () =>
      insertSignal(env, {
        workspace_id: workspaceId, entity_id: entityId, source_id: source.id,
        watch_id: watchId, snapshot_id: snapId,
        kind: "change", aspect: "pricing", title: "t", summary: "s",
        url: "https://allbirds.com/pricing", dedup_key: "dup-1", payload: {},
      });
    await insert();
    await insert();
    const count = await env.DB.prepare(
      "SELECT count(*) AS n FROM signal WHERE dedup_key = 'dup-1'",
    ).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("lists only watches whose entity is on and source is site", async () => {
    const { workspaceId } = await seedBase();
    const source = await ensureSiteSource(env);
    const on = await seedEntity(workspaceId, "competitor", "on.com");
    const off = await seedEntity(workspaceId, "competitor", "off.com", "off");
    const onWatch = await seedWatch(on, source.id, "https://on.com/");
    const offWatch = await seedWatch(off, source.id, "https://off.com/");
    const due = await listDueSiteWatches(env);
    const ids = due.map((w) => w.id);
    expect(ids).toContain(onWatch);
    expect(ids).not.toContain(offWatch);
  });

  it("recordWatchFailure opens an incident for a self watch, never for a competitor", async () => {
    const { workspaceId } = await seedBase();
    const source = await ensureSiteSource(env);
    const selfId = await seedEntity(workspaceId, "self", "0509.io");
    const selfPage = await upsertPage(env, selfId, "https://0509.io/");
    const selfWatch = await seedWatch(selfId, source.id, "https://0509.io/");
    await recordWatchFailure(env, selfWatch, new Error("browser unreachable"));
    const inc = await env.DB.prepare(
      "SELECT kind FROM incident WHERE page_id = ? AND closed_at IS NULL",
    ).bind(selfPage.id).first<{ kind: string }>();
    expect(inc?.kind).toBe("capture_failed");
    const alert = await env.DB.prepare(
      "SELECT severity FROM alert WHERE incident_id IS NOT NULL",
    ).first<{ severity: string }>();
    expect(alert?.severity).toBe("high");

    const compId = await seedEntity(workspaceId, "competitor", "rival.com");
    const compPage = await upsertPage(env, compId, "https://rival.com/");
    const compWatch = await seedWatch(compId, source.id, "https://rival.com/");
    await recordWatchFailure(env, compWatch, new Error("browser unreachable"));
    const none = await env.DB.prepare(
      "SELECT count(*) AS n FROM incident WHERE page_id = ?",
    ).bind(compPage.id).first<{ n: number }>();
    expect(none?.n).toBe(0);
  });

  it(
    "runs the workflow end to end: a failing watch retries, then lands as a recorded failure",
    { timeout: 180_000 },
    async () => {
      const { workspaceId } = await seedBase();
      const source = await ensureSiteSource(env);
      const selfId = await seedEntity(workspaceId, "self", "0509.io");
      const watchId = await seedWatch(selfId, source.id, "https://0509.io/");
      const instance = await env.SITE_SWEEP.create({
        id: `test-sweep-${crypto.randomUUID()}`,
        params: { watchIds: [watchId] },
      });
      await vi.waitUntil(
        async () => {
          const s = await instance.status();
          return s.status === "complete" || s.status === "errored";
        },
        { timeout: 150_000, interval: 5_000 },
      );
      const final = await instance.status();
      expect(final.status).toBe("complete");
      const inc = await env.DB.prepare(
        "SELECT i.kind FROM incident i JOIN entity e ON e.id = i.entity_id WHERE e.id = ?",
      ).bind(selfId).first<{ kind: string }>();
      expect(inc?.kind).toBe("capture_failed");
    },
  );
});
