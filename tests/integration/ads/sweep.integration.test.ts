import { env, introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertCoverage,
  consumeSweepMessage,
  escalateCoverage,
  selectSweepWatches,
  type SweepMessage,
  type SweepPull,
} from "../../../workers/ads-sweep";
import { handleSweepBatch } from "../../../workers/queue-consumers";

const WS = "ws-ads-sweep";
const USER = "user-ads-sweep";
const TICK = "2026-09-22";
const PREV = "2026-09-21";

const browserDescriptor = {
  transport: "browser",
  endpoint: "https://ads.example.com/library/?q={target}",
  waitForSelector: ".ad-card",
  rateLimitPerMinute: 4,
  reliability: "scraped_page",
};

const apiDescriptor = {
  transport: "api",
  endpoint: "https://library.example.com/ads?advertiser={target}",
  method: "GET",
  rateLimitPerMinute: 30,
  reliability: "official_api",
};

const pullOk: SweepPull = () =>
  Promise.resolve({
    payload: "<html><body><div class='ad-card'>Gymshark</div></body></html>",
    status: 200,
  });

async function seedBase(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Reader', 'ads-sweep@0509.io', 1, '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`,
  )
    .bind(USER)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Ads sweep', ?, 'UTC', 1, 8, '2026-09-22T00:00:00Z')`,
  )
    .bind(WS, USER)
    .run();
}

async function seedWatch(options: {
  watchId: string;
  sourceId: string;
  entityId: string;
  domain: string;
  state?: string;
  enabled?: number;
  active?: number;
  transport?: "browser" | "api";
  platform?: string;
  endpoint?: string;
}): Promise<void> {
  const transport = options.transport ?? "browser";
  const descriptor = {
    ...(transport === "browser" ? browserDescriptor : apiDescriptor),
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
  };
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, state, created_at)
     VALUES (?, ?, 'competitor', ?, ?, '2026-09-22T00:00:00Z')`,
  )
    .bind(options.entityId, WS, options.domain, options.state ?? "on")
    .run();
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
     VALUES (?, ?, 'ads', ?, ?, ?, ?, ?)`,
  )
    .bind(
      options.sourceId,
      `ads.${options.sourceId}`,
      options.platform ?? "meta",
      `ads.${options.sourceId}`,
      transport === "browser" ? "scraped_page" : "official_api",
      options.enabled ?? 1,
      JSON.stringify(descriptor),
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO watch (id, entity_id, source_id, target_key, is_active)
     VALUES (?, ?, ?, 'gymshark.com', ?)`,
  )
    .bind(options.watchId, options.entityId, options.sourceId, options.active ?? 1)
    .run();
}

async function cleanup(): Promise<void> {
  const stored = await env.CARD_ARTIFACTS.list({ prefix: "ads/" });
  for (const object of stored.objects) {
    await env.CARD_ARTIFACTS.delete(object.key);
  }
  await env.DB.exec("DELETE FROM snapshot");
  await env.DB.exec("DELETE FROM watch");
  await env.DB.exec("DELETE FROM entity");
  await env.DB.exec("DELETE FROM source WHERE id LIKE 'src_sweep_%'");
  await env.DB.exec("DELETE FROM workspace WHERE id = 'ws-ads-sweep'");
  await env.DB.exec('DELETE FROM "user" WHERE id = \'user-ads-sweep\'');
}

function message(watchId: string, tick = TICK, round: 0 | 1 = 0): SweepMessage {
  return { watchId, tick, round };
}

describe("ads sweep (0509#3891 P3)", () => {
  afterEach(async () => {
    await cleanup();
  });

  it("selects only enabled ads watches on entities that are on", async () => {
    await seedBase();
    await seedWatch({
      watchId: "watch-on",
      sourceId: "src_sweep_on",
      entityId: "ent-on",
      domain: "on.example",
      transport: "browser",
    });
    await seedWatch({
      watchId: "watch-off",
      sourceId: "src_sweep_off",
      entityId: "ent-off",
      domain: "off.example",
      state: "off",
    });
    await seedWatch({
      watchId: "watch-disabled",
      sourceId: "src_sweep_disabled",
      entityId: "ent-disabled",
      domain: "disabled.example",
      enabled: 0,
      transport: "api",
    });
    await seedWatch({
      watchId: "watch-inactive",
      sourceId: "src_sweep_inactive",
      entityId: "ent-inactive",
      domain: "inactive.example",
      active: 0,
    });

    const watches = (await selectSweepWatches(env.DB)).watches;
    expect(watches.map((watch) => watch.watchId)).toEqual(["watch-on"]);
    expect(watches[0]?.transport).toBe("browser");
  });

  it("writes one snapshot and one R2 object, and a second delivery does not add a row", async () => {
    await seedBase();
    await seedWatch({
      watchId: "watch-pull",
      sourceId: "src_sweep_pull",
      entityId: "ent-pull",
      domain: "pull.example",
    });

    const first = await consumeSweepMessage(env.DB, env.CARD_ARTIFACTS, message("watch-pull"), pullOk);
    const second = await consumeSweepMessage(env.DB, env.CARD_ARTIFACTS, message("watch-pull"), pullOk);
    expect(first).toBe("ack");
    expect(second).toBe("ack");

    const rows = await env.DB.prepare(
      "SELECT id, watch_id, fetched_at, payload_r2_key, item_count FROM snapshot",
    ).all<{
      id: string;
      watch_id: string;
      fetched_at: string;
      payload_r2_key: string;
      item_count: number;
    }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({
      id: "snap-watch-pull-2026-09-22",
      watch_id: "watch-pull",
      fetched_at: TICK,
      payload_r2_key: "ads/watch-pull/2026-09-22",
      item_count: 0,
    });
    const stored = await env.CARD_ARTIFACTS.get("ads/watch-pull/2026-09-22");
    expect(stored).not.toBeNull();
    expect(await stored?.text()).toContain("Gymshark");
  });

  it("retries a thrown pull and does not write a snapshot", async () => {
    await seedBase();
    await seedWatch({
      watchId: "watch-throw",
      sourceId: "src_sweep_throw",
      entityId: "ent-throw",
      domain: "throw.example",
    });
    const acked: string[] = [];
    const retried: string[] = [];
    const batch = {
      queue: "page-sweep",
      messages: [
        {
          id: "msg-throw",
          timestamp: new Date("2026-09-22T02:00:00Z"),
          body: message("watch-throw"),
          attempts: 1,
          ack: () => {
            acked.push("msg-throw");
          },
          retry: () => {
            retried.push("msg-throw");
          },
        },
      ],
      metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
      ackAll: () => undefined,
      retryAll: () => undefined,
    };
    await handleSweepBatch(env, batch, () => {
      throw new Error("upstream reset");
    });
    expect(acked).toEqual([]);
    expect(retried).toEqual(["msg-throw"]);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM snapshot").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("acks a non-2xx pull, stores item_count 0, and marks the watch degraded", async () => {
    await seedBase();
    await seedWatch({
      watchId: "watch-block",
      sourceId: "src_sweep_block",
      entityId: "ent-block",
      domain: "block.example",
    });
    const outcome = await consumeSweepMessage(
      env.DB,
      env.CARD_ARTIFACTS,
      message("watch-block"),
      () => Promise.resolve({ payload: "challenge", status: 403 }),
    );
    expect(outcome).toBe("ack");
    const snap = await env.DB.prepare(
      "SELECT item_count FROM snapshot WHERE id = ?",
    )
      .bind("snap-watch-block-2026-09-22")
      .first<{ item_count: number }>();
    expect(snap?.item_count).toBe(0);
    const watch = await env.DB.prepare("SELECT config_json FROM watch WHERE id = ?")
      .bind("watch-block")
      .first<{ config_json: string }>();
    const config = JSON.parse(watch?.config_json ?? "{}") as {
      sweep?: { blocked_status?: number; degraded_at?: string };
    };
    expect(config.sweep?.blocked_status).toBe(403);
    expect(config.sweep?.degraded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("clears a block on the next good pull and keeps the dead-letter record", async () => {
    await seedBase();
    await seedWatch({
      watchId: "watch-recover",
      sourceId: "src_sweep_recover",
      entityId: "ent-recover",
      domain: "recover.example",
    });
    await env.DB.prepare("UPDATE watch SET config_json = ? WHERE id = ?")
      .bind(
        JSON.stringify({
          sweep: {
            blocked_status: 403,
            degraded_at: "2026-09-21T02:00:00.000Z",
            dead_letter_queue: "page-sweep-dlq",
            dead_letter_id: "deadbeef",
            dead_letter_tick: PREV,
          },
        }),
        "watch-recover",
      )
      .run();
    const outcome = await consumeSweepMessage(
      env.DB,
      env.CARD_ARTIFACTS,
      message("watch-recover"),
      pullOk,
    );
    expect(outcome).toBe("ack");
    const watch = await env.DB.prepare("SELECT config_json FROM watch WHERE id = ?")
      .bind("watch-recover")
      .first<{ config_json: string }>();
    const sweep = (
      JSON.parse(watch?.config_json ?? "{}") as {
        sweep?: {
          blocked_status?: number;
          degraded_at?: string;
          dead_letter_queue?: string;
          dead_letter_id?: string;
        };
      }
    ).sweep;
    expect(sweep?.blocked_status).toBeUndefined();
    expect(sweep?.degraded_at).toBeUndefined();
    expect(sweep?.dead_letter_queue).toBe("page-sweep-dlq");
    expect(sweep?.dead_letter_id).toBe("deadbeef");
  });

  it("re-enqueues only the watches that have no snapshot for the tick", async () => {
    await seedBase();
    await seedWatch({
      watchId: "watch-have",
      sourceId: "src_sweep_have",
      entityId: "ent-have",
      domain: "have.example",
      transport: "api",
    });
    await seedWatch({
      watchId: "watch-miss",
      sourceId: "src_sweep_miss",
      entityId: "ent-miss",
      domain: "miss.example",
    });
    await consumeSweepMessage(env.DB, env.CARD_ARTIFACTS, message("watch-have"), pullOk);
    const sent: SweepMessage[] = [];
    const watches = (await selectSweepWatches(env.DB)).watches;
    const result = await assertCoverage(env.DB, watches, TICK, {
      page: {
        sendBatch: (messages) => {
          for (const item of messages) sent.push(item.body);
          return Promise.resolve();
        },
      },
      fetch: {
        sendBatch: () => Promise.resolve(),
      },
    });
    expect(result.covered).toBe(1);
    expect(result.retried).toBe(1);
    expect(sent).toEqual([{ watchId: "watch-miss", tick: TICK, round: 1 }]);
  });

  it("degrades a source only after a second consecutive missed tick", async () => {
    await seedBase();
    await seedWatch({
      watchId: "watch-gap",
      sourceId: "src_sweep_gap",
      entityId: "ent-gap",
      domain: "gap.example",
    });
    const watches = (await selectSweepWatches(env.DB)).watches;
    const first = await escalateCoverage(env.DB, env.CARD_ARTIFACTS, PREV, watches, 1200, 1);
    expect(first.degradedSourceIds).toEqual([]);
    const second = await escalateCoverage(env.DB, env.CARD_ARTIFACTS, TICK, watches, 2400, 1);
    expect(second.degradedSourceIds).toEqual(["src_sweep_gap"]);
    const record = await env.CARD_ARTIFACTS.get(`ads/sweeps/${TICK}.json`);
    const body = JSON.parse(await record?.text() ?? "{}") as {
      measured_ms: number;
      queue_depth: number;
      missing_watch_ids: string[];
      degraded_source_ids: string[];
      cap: {
        page_sweep_max_concurrency: number;
        proposed_page_sweep_max_concurrency: number;
        usd_per_additional_browser_month: number;
      };
    };
    expect(body.measured_ms).toBe(2400);
    expect(body.queue_depth).toBe(1);
    expect(body.missing_watch_ids).toEqual(["watch-gap"]);
    expect(body.degraded_source_ids).toEqual(["src_sweep_gap"]);
    expect(body.cap).toEqual({
      page_sweep_max_concurrency: 8,
      proposed_page_sweep_max_concurrency: 9,
      usd_per_additional_browser_month: 2,
    });
  });

  it("keeps the other watches when one ads descriptor does not parse", async () => {
    await seedBase();
    await seedWatch({
      watchId: "watch-good",
      sourceId: "src_sweep_good",
      entityId: "ent-good",
      domain: "good.example",
    });
    await seedWatch({
      watchId: "watch-bad",
      sourceId: "src_sweep_bad",
      entityId: "ent-bad",
      domain: "bad.example",
      transport: "api",
    });
    await env.DB.prepare("UPDATE source SET config_json = ? WHERE id = ?")
      .bind("{}", "src_sweep_bad")
      .run();
    const selection = await selectSweepWatches(env.DB);
    expect(selection.watches.map((watch) => watch.watchId)).toEqual(["watch-good"]);
    expect(selection.invalid).toEqual([
      { watchId: "watch-bad", sourceId: "src_sweep_bad" },
    ]);
    const escalated = await escalateCoverage(
      env.DB,
      env.CARD_ARTIFACTS,
      TICK,
      selection.watches,
      10,
      0,
      selection.invalid,
    );
    expect(escalated.degradedSourceIds).toEqual(["src_sweep_bad"]);
  });

  it("retries a blocked pull when the watch config cannot store the degrade mark", async () => {
    await seedBase();
    await seedWatch({
      watchId: "watch-corrupt-block",
      sourceId: "src_sweep_corrupt_block",
      entityId: "ent-corrupt-block",
      domain: "corrupt-block.example",
    });
    await env.DB.prepare("UPDATE watch SET config_json = ? WHERE id = ?")
      .bind("{", "watch-corrupt-block")
      .run();
    const outcome = await consumeSweepMessage(
      env.DB,
      env.CARD_ARTIFACTS,
      message("watch-corrupt-block"),
      () => Promise.resolve({ payload: "challenge", status: 403 }),
    );
    expect(outcome).toBe("retry");
    const watch = await env.DB.prepare("SELECT config_json FROM watch WHERE id = ?")
      .bind("watch-corrupt-block")
      .first<{ config_json: string }>();
    expect(watch?.config_json).toBe("{");
    const count = await env.DB.prepare("SELECT count(*) AS n FROM snapshot").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("keeps the dead-letter and block marks when a previously missed watch is covered", async () => {
    await seedBase();
    await seedWatch({
      watchId: "watch-keep",
      sourceId: "src_sweep_keep",
      entityId: "ent-keep",
      domain: "keep.example",
    });
    await env.DB.prepare("UPDATE watch SET config_json = ? WHERE id = ?")
      .bind(
        JSON.stringify({
          sweep: {
            last_miss_tick: PREV,
            degraded_at: "2026-09-21T02:00:00.000Z",
            blocked_status: 403,
            dead_letter_queue: "fetch-sweep-dlq",
            dead_letter_id: "abc123",
            dead_letter_tick: PREV,
          },
        }),
        "watch-keep",
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO snapshot (id, watch_id, fetched_at, payload_hash) VALUES (?, ?, ?, ?)",
    )
      .bind("snap-watch-keep-2026-09-22", "watch-keep", TICK, "hash")
      .run();
    const watches = (await selectSweepWatches(env.DB)).watches;
    await escalateCoverage(env.DB, env.CARD_ARTIFACTS, TICK, watches, 900, 0);
    const watch = await env.DB.prepare("SELECT config_json FROM watch WHERE id = ?")
      .bind("watch-keep")
      .first<{ config_json: string }>();
    const sweep = (
      JSON.parse(watch?.config_json ?? "{}") as {
        sweep?: {
          last_miss_tick?: string;
          degraded_at?: string;
          blocked_status?: number;
          dead_letter_queue?: string;
          dead_letter_id?: string;
          measured_ms?: number;
        };
      }
    ).sweep;
    expect(sweep?.last_miss_tick).toBeUndefined();
    expect(sweep?.degraded_at).toBe("2026-09-21T02:00:00.000Z");
    expect(sweep?.blocked_status).toBe(403);
    expect(sweep?.dead_letter_queue).toBe("fetch-sweep-dlq");
    expect(sweep?.dead_letter_id).toBe("abc123");
    expect(sweep?.measured_ms).toBe(900);
  });

  it("degrades an unreadable watch config without replacing it", async () => {
    await seedBase();
    await seedWatch({
      watchId: "watch-corrupt",
      sourceId: "src_sweep_corrupt",
      entityId: "ent-corrupt",
      domain: "corrupt.example",
    });
    await env.DB.prepare("UPDATE watch SET config_json = ? WHERE id = ?")
      .bind("{", "watch-corrupt")
      .run();
    const watches = (await selectSweepWatches(env.DB)).watches;
    const result = await escalateCoverage(env.DB, env.CARD_ARTIFACTS, TICK, watches, 500, 1);
    expect(result.degradedSourceIds).toEqual(["src_sweep_corrupt"]);
    const watch = await env.DB.prepare("SELECT config_json FROM watch WHERE id = ?")
      .bind("watch-corrupt")
      .first<{ config_json: string }>();
    expect(watch?.config_json).toBe("{");
  });

  it("moves a pull that keeps failing onto the dead-letter queue", async () => {
    await seedBase();
    await seedWatch({
      watchId: "watch-dlq",
      sourceId: "src_sweep_dlq",
      entityId: "ent-dlq",
      domain: "dlq.example",
      transport: "api",
      endpoint: "https://127.0.0.1:1/ads?advertiser={target}",
    });
    await env.FETCH_SWEEP.send({ watchId: "watch-dlq", tick: TICK, round: 0 });
    const deadline = Date.now() + 12_000;
    let deadLetter: { dead_letter_queue?: string; dead_letter_tick?: string; dead_letter_id?: string } =
      {};
    while (Date.now() < deadline && deadLetter.dead_letter_queue === undefined) {
      const watch = await env.DB.prepare("SELECT config_json FROM watch WHERE id = ?")
        .bind("watch-dlq")
        .first<{ config_json: string }>();
      const config = JSON.parse(watch?.config_json ?? "{}") as {
        sweep?: { dead_letter_queue?: string; dead_letter_tick?: string; dead_letter_id?: string };
      };
      deadLetter = config.sweep ?? {};
      if (deadLetter.dead_letter_queue === undefined) {
        await scheduler.wait(200);
      }
    }
    expect(deadLetter.dead_letter_queue).toBe("fetch-sweep-dlq");
    expect(deadLetter.dead_letter_tick).toBe(TICK);
    expect(deadLetter.dead_letter_id).toMatch(/^[0-9a-f]{32}$/);
  }, 20_000);

  it("runs the workflow through select, enqueue, settle, assert and escalate", async () => {
    await seedBase();
    await seedWatch({
      watchId: "watch-wf",
      sourceId: "src_sweep_wf",
      entityId: "ent-wf",
      domain: "wf.example",
      transport: "api",
      endpoint: "https://127.0.0.1:1/ads?advertiser={target}",
    });
    const id = `ads-sweep-it-${crypto.randomUUID()}`;
    const tick = "2099-01-15";
    const instance = await introspectWorkflowInstance(env.ADS_SWEEP, id);
    try {
      await instance.modify(async (modifier) => {
        await modifier.disableSleeps();
        await modifier.disableRetryDelays();
        await modifier.mockStepError({ name: "select" }, new Error("transient select"), 1);
      });
      await env.ADS_SWEEP.create({ id, params: { tick } });
      try {
        await instance.waitForStatus("complete");
      } catch (err) {
        const failure = await instance.getError();
        throw new Error(`workflow ${failure.name}: ${failure.message}`, { cause: err });
      }
      const selected = (await instance.waitForStepResult({ name: "select" })) as {
        ids: string[];
      };
      const enqueued = (await instance.waitForStepResult({ name: "enqueue" })) as {
        page: number;
        fetch: number;
      };
      expect(selected.ids).toEqual(["watch-wf"]);
      expect(enqueued).toEqual({ page: 0, fetch: 1 });
      await instance.waitForStepResult({ name: "assert" });
      await instance.waitForStepResult({ name: "escalate" });
      const output = (await instance.getOutput()) as {
        tick: string;
        selected: number;
        enqueuedPage: number;
        enqueuedFetch: number;
        covered: number;
        retried: number;
      };
      expect(output.tick).toBe(tick);
      expect(output.selected).toBe(1);
      expect(output.enqueuedPage).toBe(0);
      expect(output.enqueuedFetch).toBe(1);
      expect(output.covered + output.retried).toBe(1);
      const record = await env.CARD_ARTIFACTS.get(`ads/sweeps/${tick}.json`);
      expect(record).not.toBeNull();
    } finally {
      await instance.dispose();
    }
  });
});
