import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleFetchSweepBatch,
  parseFetchSweepMessage,
  type FetchSweepMessage,
} from "../../../workers/sources/fetch-sweep-consumer";

/**
 * The fetch-sweep consumer (0509#5261). The identity tail puts one message per
 * seeded watch onto the queue (`enqueueFirstSweep`); this consumer is the thing
 * that collects it, on the lane that never opens a browser, and a message that
 * exhausts its retries lands in fetch-sweep-dlq instead of being deleted.
 */

interface BrowserStub {
  calls: string[];
  closed: number;
  quickAction(action: "content", options: { url: string }): Promise<Response>;
}

const browserHolder = vi.hoisted(() => ({ current: undefined as undefined | BrowserStub }));

function installBrowser(): void {
  Object.defineProperty(env, "BROWSER", {
    configurable: true,
    get() {
      return browserHolder.current;
    },
  });
}

function browserStub(): BrowserStub {
  const calls: string[] = [];
  const state = { closed: 0 };
  return {
    calls,
    get closed() {
      return state.closed;
    },
    async quickAction(action, options) {
      calls.push(options.url);
      void action;
      return new Response(JSON.stringify({ success: true, result: "", meta: { status: 200 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    close() {
      state.closed += 1;
      return Promise.resolve();
    },
  };
}

const USER = "user-fetch-sweep";
const WS = "ws-fetch-sweep";
const NOW = "2026-09-24T02:00:00Z";
const SITE_SOURCE = "src_site_web";
const ENTITY = "ent-rival";
const WATCH = "watch-rival-home";
const PAGE = "page-rival-home";
const URL = "https://rival.com/";

const PAD =
  "Every plan includes unlimited projects, priority support, single sign-on, audit logs, and a named account manager who answers within one business day, with onboarding help for your whole team.";

const HOME_HTML = `<!doctype html><html><body><h1>Rival</h1><p>Plans start at ten dollars a month.</p><p>${PAD}</p></body></html>`;

interface BatchCall {
  acked: number[];
  retried: number[];
}

const batchFor = (bodies: unknown[]): { batch: MessageBatch; calls: BatchCall } => {
  const calls: BatchCall = { acked: [], retried: [] };
  const batch: MessageBatch = {
    queue: "fetch-sweep",
    messages: bodies.map((body, index) => ({
      id: `msg-${index}`,
      timestamp: new Date("2026-09-24T02:00:03Z"),
      body,
      attempts: 1,
      ack: () => calls.acked.push(index),
      retry: () => calls.retried.push(index),
    })),
    metadata: { metrics: { backlogCount: bodies.length, backlogBytes: 0 } },
    ackAll: () => calls.acked.push(...bodies.map((_, index) => index)),
    retryAll: () => calls.retried.push(...bodies.map((_, index) => index)),
  };
  return { batch, calls };
};

const message = (): FetchSweepMessage => ({
  watchId: WATCH,
  entityId: ENTITY,
  sourceId: SITE_SOURCE,
  targetKey: URL,
});

const resetTenant = async () => {
  await env.DB.exec("DELETE FROM signal");
  await env.DB.exec("DELETE FROM snapshot");
  await env.DB.exec("DELETE FROM watch");
  await env.DB.exec("DELETE FROM page");
  await env.DB.exec("DELETE FROM entity");
  await env.DB.exec("DELETE FROM workspace");
  await env.DB.exec('DELETE FROM "user"');

  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Owner', 'fetch-sweep@0509.io', 1, ?, ?)`,
  )
    .bind(USER, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Fetch sweep', ?, 'UTC', 1, 8, ?)`,
  )
    .bind(WS, USER, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, 'competitor', 'rival.com', '{}', 'manual', 'on', ?)`,
  )
    .bind(ENTITY, WS, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO page (id, entity_id, url, role, discovered_at)
     VALUES (?, ?, ?, 'home', ?)`,
  )
    .bind(PAGE, ENTITY, URL, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(WATCH, ENTITY, SITE_SOURCE, URL)
    .run();
};

const snapshots = async () =>
  (
    await env.DB.prepare(
      `SELECT id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash
         FROM snapshot WHERE watch_id = ? ORDER BY fetched_at ASC`,
    )
      .bind(WATCH)
      .all<{
        id: string;
        watch_id: string;
        page_id: string | null;
        fetched_at: string;
        payload_r2_key: string | null;
        payload_hash: string;
      }>()
  ).results ?? [];

const watchPolledAt = async () => {
  const row = await env.DB.prepare("SELECT last_polled_at FROM watch WHERE id = ?")
    .bind(WATCH)
    .first<{ last_polled_at: string | null }>();
  return row?.last_polled_at ?? null;
};

describe("fetch-sweep consumer (0509#5261)", () => {
  beforeEach(async () => {
    await resetTenant();
    const listed = await env.SNAPSHOTS.list({ prefix: `snapshot/site/${WATCH}/` });
    await Promise.all(listed.objects.map((object) => env.SNAPSHOTS.delete(object.key)));

    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      void input;
      return Promise.resolve(new Response(HOME_HTML, { status: 200 }));
    });
    browserHolder.current = browserStub();
    installBrowser();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    browserHolder.current = undefined;
  });

  it("never opens a browser on the fetch lane, even for a thin page that would escalate", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response('<!doctype html><html><body><div id="app"></div></body></html>', { status: 200 })),
    );
    const stub = browserHolder.current;
    if (stub === undefined) throw new Error("expected the browser stub");

    const results = await handleFetchSweepBatch(batchFor([message()]).batch);

    expect(results).toEqual(["failed"]);
    expect(stub.calls).toEqual([]);
    expect(stub.closed).toBe(0);
  });

  it("collects the identity tail's message: first snapshot written, watch polled, acked", async () => {
    const { batch, calls } = batchFor([message()]);

    const results = await handleFetchSweepBatch(batch);

    expect(results).toEqual(["first"]);
    expect(calls.acked).toEqual([0]);
    expect(calls.retried).toEqual([]);

    const rows = await snapshots();
    expect(rows).toHaveLength(1);
    expect(rows[0].page_id).toBe(PAGE);
    expect(rows[0].payload_r2_key).toBe(`snapshot/site/${WATCH}/${rows[0].id}.txt`);
    expect(await watchPolledAt()).not.toBeNull();

    const stored = await env.SNAPSHOTS.get(`snapshot/site/${WATCH}/${rows[0].id}.txt`);
    expect(stored).not.toBeNull();
  });

  it("collects an unchanged page on the second delivery with the same hash", async () => {
    const first = await handleFetchSweepBatch(batchFor([message()]).batch);
    expect(first).toEqual(["first"]);

    const rows = await snapshots();
    expect(rows).toHaveLength(1);

    const second = await handleFetchSweepBatch(batchFor([message()]).batch);
    expect(second).toEqual(["unchanged"]);
  });

  it("files the change when a redelivered message finds a page that moved", async () => {
    const judge = {
      async run(_model: string, request: { questions: Record<string, { type: string }> }) {
        const answers: Record<string, { type: "noul"; noul: number } | { type: "choice"; choice: string }> = {};
        for (const [id, question] of Object.entries(request.questions)) {
          answers[id] = question.type === "noul" ? { type: "noul", noul: 0.95 } : { type: "choice", choice: "pricing" };
        }
        return { answers };
      },
    };
    Reflect.set(env, "AI", judge);
    try {
      const first = await handleFetchSweepBatch(batchFor([message()]).batch);
      expect(first).toEqual(["first"]);
      const baseline = await snapshots();
      expect(baseline).toHaveLength(1);

      const changedHtml = HOME_HTML.replace("ten dollars", "twelve dollars. New: team seats.");
      vi.stubGlobal("fetch", () => Promise.resolve(new Response(changedHtml, { status: 200 })));

      const changed = await handleFetchSweepBatch(batchFor([message()]).batch);
      expect(changed).toEqual(["changed"]);

      const filed = await env.DB.prepare(
        "SELECT kind, aspect, url, snapshot_id FROM signal WHERE workspace_id = ?",
      )
        .bind(WS)
        .all<{ kind: string; aspect: string; url: string; snapshot_id: string }>();
      expect(filed.results).toHaveLength(1);
      const [signal] = filed.results;
      if (signal === undefined) throw new Error("expected the change signal");
      expect(signal).toMatchObject({
        kind: "change",
        aspect: "home",
        url: URL,
        snapshot_id: `msg-0-${PAGE}`,
      });
    } finally {
      Reflect.deleteProperty(env, "AI");
    }
  });

  it("retries a fetch that never answers, so the message reaches the DLQ instead of vanishing", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new DOMException("boom", "TimeoutError")));

    const { batch, calls } = batchFor([message()]);

    const results = await handleFetchSweepBatch(batch);

    expect(results).toEqual(["failed"]);
    expect(calls.retried).toEqual([0]);
    expect(calls.acked).toEqual([]);
    expect(await snapshots()).toHaveLength(0);
    expect(await watchPolledAt()).toBeNull();
  });

  it("acks and logs a message whose watch is gone instead of looping it", async () => {
    await env.DB.prepare("DELETE FROM watch WHERE id = ?").bind(WATCH).run();

    const { batch, calls } = batchFor([message()]);

    const results = await handleFetchSweepBatch(batch);

    expect(results).toEqual(["not_collectable"]);
    expect(calls.acked).toEqual([0]);
    expect(calls.retried).toEqual([]);
    expect(await snapshots()).toHaveLength(0);
  });

  it("acks an unparseable body and never routes it to the email lane", async () => {
    expect(parseFetchSweepMessage({ digest_id: "dg-1" })).toBeNull();
    expect(parseFetchSweepMessage({ incident_id: "in-1" })).toBeNull();
    expect(parseFetchSweepMessage("not json")).toBeNull();

    const { batch, calls } = batchFor([{ digest_id: "dg-1" }, { incident_id: "in-1" }]);

    const results = await handleFetchSweepBatch(batch);

    expect(results).toEqual(["unparseable", "unparseable"]);
    expect(calls.acked).toEqual([0, 1]);
    expect(calls.retried).toEqual([]);
  });

  it("collects every message in the batch and leaves the email lane untouched", async () => {
    const emailRow = await env.DB.prepare("SELECT id FROM source WHERE id = ?")
      .bind(SITE_SOURCE)
      .first<{ id: string }>();
    expect(emailRow).toEqual({ id: SITE_SOURCE });

    const { batch, calls } = batchFor([
      message(),
      { watchId: "missing", entityId: ENTITY, sourceId: SITE_SOURCE, targetKey: URL },
      "junk",
    ]);

    const results = await handleFetchSweepBatch(batch);

    expect(results).toEqual(["first", "not_collectable", "unparseable"]);
    expect(calls.acked).toEqual([0, 1, 2]);
    expect(calls.retried).toEqual([]);
    expect(await snapshots()).toHaveLength(1);

    // The email lane's tables stay untouched: nothing was sent, nothing claimed.
    const digests = await env.DB.prepare("SELECT COUNT(*) AS n FROM digest").first<{ n: number }>();
    expect(digests?.n).toBe(0);
    const attempts = await env.DB.prepare("SELECT COUNT(*) AS n FROM send_attempt").first<{ n: number }>();
    expect(attempts?.n).toBe(0);
  });
});
