import { readFile } from "node:fs/promises";

import { flattenDiagnosticMessageText, parseConfigFileTextToJson } from "typescript";
import { describe, expect, it } from "vitest";

import {
  ADS_SWEEP_CRON,
  BROWSER_CONCURRENCY_CAP,
  FETCH_SWEEP_DLQ,
  FETCH_SWEEP_MAX_CONCURRENCY,
  FETCH_SWEEP_QUEUE,
  PAGE_SWEEP_DLQ,
  PAGE_SWEEP_MAX_CONCURRENCY,
  PAGE_SWEEP_QUEUE,
  RESERVED_INTERACTIVE_BROWSERS,
  assertBrowserCap,
} from "../../../workers/ads-cap";
import { chunkMessages, enqueueSweep, previousTick } from "../../../workers/ads-sweep";
import { handleSweepBatch } from "../../../workers/queue-consumers";
import { startAdsSweep, sweepInstanceId } from "../../../workers/schedule";

interface QueueConsumerConfig {
  queue: string;
  max_retries?: number;
  max_concurrency?: number;
  max_batch_size?: number;
  max_batch_timeout?: number;
  dead_letter_queue?: string;
}

interface WranglerConfig {
  vars?: { PAGE_SWEEP_MAX_CONCURRENCY?: string; BROWSER_CONCURRENCY_CAP?: string };
  triggers?: { crons?: string[] };
  workflows?: { class_name?: string }[];
  queues?: { consumers?: QueueConsumerConfig[] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readWrangler(source: string): WranglerConfig {
  const parsed = parseConfigFileTextToJson("wrangler.jsonc", source);
  if (parsed.error) {
    throw new Error(
      `wrangler.jsonc did not parse: ${flattenDiagnosticMessageText(parsed.error.messageText, "\n")}`,
    );
  }
  if (!isRecord(parsed.config)) {
    throw new Error("wrangler.jsonc is not an object");
  }
  return {
    vars: isRecord(parsed.config.vars)
      ? {
          PAGE_SWEEP_MAX_CONCURRENCY: stringField(parsed.config.vars.PAGE_SWEEP_MAX_CONCURRENCY),
          BROWSER_CONCURRENCY_CAP: stringField(parsed.config.vars.BROWSER_CONCURRENCY_CAP),
        }
      : undefined,
    triggers: readTriggers(parsed.config.triggers),
    workflows: readWorkflows(parsed.config.workflows),
    queues: readQueues(parsed.config.queues),
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readTriggers(value: unknown): { crons?: string[] } | undefined {
  if (!isRecord(value) || !Array.isArray(value.crons)) return undefined;
  const crons = value.crons.filter((item): item is string => typeof item === "string");
  return { crons };
}

function readWorkflows(value: unknown): { class_name?: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((item) => ({
    class_name: stringField(item.class_name),
  }));
}

function readQueues(value: unknown): { consumers?: QueueConsumerConfig[] } | undefined {
  if (!isRecord(value) || !Array.isArray(value.consumers)) return undefined;
  const consumers: QueueConsumerConfig[] = [];
  for (const item of value.consumers) {
    if (!isRecord(item) || typeof item.queue !== "string") continue;
    consumers.push({
      queue: item.queue,
      max_retries: numberField(item.max_retries),
      max_concurrency: numberField(item.max_concurrency),
      max_batch_size: numberField(item.max_batch_size),
      max_batch_timeout: numberField(item.max_batch_timeout),
      dead_letter_queue: stringField(item.dead_letter_queue),
    });
  }
  return { consumers };
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function consumer(config: WranglerConfig, queue: string): QueueConsumerConfig {
  const found = config.queues?.consumers?.find((item) => item.queue === queue);
  if (!found) throw new Error(`missing consumer ${queue}`);
  return found;
}

describe("ads browser cap", () => {
  it("holds when page-sweep is 8 and the cap is 10", () => {
    expect(PAGE_SWEEP_MAX_CONCURRENCY + RESERVED_INTERACTIVE_BROWSERS).toBe(
      BROWSER_CONCURRENCY_CAP,
    );
    expect(() =>
      assertBrowserCap(PAGE_SWEEP_MAX_CONCURRENCY, BROWSER_CONCURRENCY_CAP),
    ).not.toThrow();
  });

  it("fails when page-sweep max_concurrency is 9", () => {
    expect(() => assertBrowserCap(9, BROWSER_CONCURRENCY_CAP)).toThrow(/above 8/);
  });

  it("fails when the reserved browsers no longer add up to the cap", () => {
    expect(() => assertBrowserCap(PAGE_SWEEP_MAX_CONCURRENCY, 9)).toThrow(/cap is 9/);
  });

  it("matches the committed wrangler consumers, cap and cron", async () => {
    const wrangler = readWrangler(await readFile("wrangler.jsonc", "utf8"));
    expect(wrangler.vars?.PAGE_SWEEP_MAX_CONCURRENCY).toBe(String(PAGE_SWEEP_MAX_CONCURRENCY));
    expect(wrangler.vars?.BROWSER_CONCURRENCY_CAP).toBe(String(BROWSER_CONCURRENCY_CAP));
    expect(wrangler.triggers?.crons).toContain(ADS_SWEEP_CRON);
    expect(wrangler.workflows?.some((item) => item.class_name === "AdsSweepWorkflow")).toBe(
      true,
    );

    const page = consumer(wrangler, PAGE_SWEEP_QUEUE);
    expect(page.max_concurrency).toBe(PAGE_SWEEP_MAX_CONCURRENCY);
    expect(page.max_retries).toBe(3);
    expect(page.max_batch_size).toBe(10);
    expect(page.max_batch_timeout).toBe(5);
    expect(page.dead_letter_queue).toBe(PAGE_SWEEP_DLQ);

    const fetchSweep = consumer(wrangler, FETCH_SWEEP_QUEUE);
    expect(fetchSweep.max_concurrency).toBe(FETCH_SWEEP_MAX_CONCURRENCY);
    expect(fetchSweep.dead_letter_queue).toBe(FETCH_SWEEP_DLQ);
    expect(fetchSweep.max_retries).toBe(3);

    expect(consumer(wrangler, PAGE_SWEEP_DLQ).max_retries).toBe(3);
    expect(consumer(wrangler, FETCH_SWEEP_DLQ).max_retries).toBe(3);
  });
});

describe("ads sweep planning", () => {
  it("steps a UTC date back one day, including month and year boundaries", () => {
    expect(previousTick("2026-09-22")).toBe("2026-09-21");
    expect(previousTick("2026-09-01")).toBe("2026-08-31");
    expect(previousTick("2026-01-01")).toBe("2025-12-31");
  });

  it("sends browser and api watches in batches of 100", async () => {
    const watches = Array.from({ length: 250 }, (_, index) => ({
      watchId: `w-${String(index)}`,
      sourceId: "src",
      targetKey: "gymshark.com",
      transport: index < 150 ? ("browser" as const) : ("api" as const),
      platform: "meta",
    }));
    const pageBatches: unknown[] = [];
    const fetchBatches: unknown[] = [];
    const counts = await enqueueSweep(watches, "2026-09-22", 0, {
      page: {
        sendBatch: (messages) => {
          pageBatches.push([...messages]);
          return Promise.resolve();
        },
      },
      fetch: {
        sendBatch: (messages) => {
          fetchBatches.push([...messages]);
          return Promise.resolve();
        },
      },
    });
    expect(counts).toEqual({ page: 150, fetch: 100 });
    expect(pageBatches.map((batch) => batch.length)).toEqual([100, 50]);
    expect(fetchBatches.map((batch) => batch.length)).toEqual([100]);
    expect(chunkMessages([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  it("enqueues meta and google ahead of the long tail and still sends every watch", async () => {
    const sent: { watchId: string; queue: string }[] = [];
    const watches = [
      {
        watchId: "w-li",
        sourceId: "src",
        targetKey: "gymshark.com",
        transport: "browser" as const,
        platform: "linkedin",
      },
      {
        watchId: "w-meta",
        sourceId: "src",
        targetKey: "gymshark.com",
        transport: "browser" as const,
        platform: "meta",
      },
      {
        watchId: "w-rd",
        sourceId: "src",
        targetKey: "gymshark.com",
        transport: "api" as const,
        platform: "reddit",
      },
      {
        watchId: "w-gg",
        sourceId: "src",
        targetKey: "gymshark.com",
        transport: "browser" as const,
        platform: "google",
      },
    ];
    const capture = (queue: string) => (messages: Iterable<{ body: { watchId: string } }>) => {
      for (const item of messages) sent.push({ watchId: item.body.watchId, queue });
      return Promise.resolve();
    };
    const counts = await enqueueSweep(watches, "2026-09-22", 0, {
      page: { sendBatch: capture("page") },
      fetch: { sendBatch: capture("fetch") },
    });
    expect(counts).toEqual({ page: 3, fetch: 1 });
    expect(sent.filter((item) => item.queue === "page").map((item) => item.watchId)).toEqual([
      "w-meta",
      "w-gg",
      "w-li",
    ]);
    expect(sent.filter((item) => item.queue === "fetch").map((item) => item.watchId)).toEqual([
      "w-rd",
    ]);
  });

  it("starts one workflow instance per UTC day and refuses a cap that does not add up", async () => {
    const created: unknown[] = [];
    const scheduledTime = Date.parse("2026-09-22T02:00:00.000Z");
    expect(sweepInstanceId(scheduledTime)).toEqual({
      id: "ads-sweep-2026-09-22",
      tick: "2026-09-22",
    });
    const id = await startAdsSweep(
      {
        PAGE_SWEEP_MAX_CONCURRENCY: "8",
        BROWSER_CONCURRENCY_CAP: "10",
        ADS_SWEEP: {
          get: () => Promise.reject(new Error("instance.not_found")),
          create: (options) => {
            created.push(options);
            return Promise.resolve({ id: "ads-sweep-2026-09-22" });
          },
        },
      },
      scheduledTime,
    );
    expect(id).toBe("ads-sweep-2026-09-22");
    expect(created).toEqual([
      { id: "ads-sweep-2026-09-22", params: { tick: "2026-09-22" } },
    ]);
    await expect(
      startAdsSweep(
        {
          PAGE_SWEEP_MAX_CONCURRENCY: "8",
          BROWSER_CONCURRENCY_CAP: "9",
          ADS_SWEEP: {
            get: () => Promise.reject(new Error("instance.not_found")),
            create: () => Promise.resolve({ id: "should-not-run" }),
          },
        },
        scheduledTime,
      ),
    ).rejects.toThrow(/cap is 9/);
    await expect(
      startAdsSweep(
        {
          PAGE_SWEEP_MAX_CONCURRENCY: "9",
          BROWSER_CONCURRENCY_CAP: "10",
          ADS_SWEEP: {
            get: () => Promise.reject(new Error("instance.not_found")),
            create: () => Promise.resolve({ id: "should-not-run" }),
          },
        },
        scheduledTime,
      ),
    ).rejects.toThrow(/above 8/);
  });

  it("does not create a second instance when the day's workflow already exists", async () => {
    let created = 0;
    const id = await startAdsSweep(
      {
        PAGE_SWEEP_MAX_CONCURRENCY: "8",
        BROWSER_CONCURRENCY_CAP: "10",
        ADS_SWEEP: {
          get: () => Promise.resolve({ id: "ads-sweep-2026-09-22" }),
          create: () => {
            created += 1;
            return Promise.resolve({ id: "ads-sweep-2026-09-22" });
          },
        },
      },
      Date.parse("2026-09-22T02:00:00.000Z"),
    );
    expect(id).toBe("ads-sweep-2026-09-22");
    expect(created).toBe(0);
  });

  it("retries a body that is not a sweep message instead of dropping it", async () => {
    const calls: string[] = [];
    await handleSweepBatch(
      {
        DB: {} as D1Database,
        CARD_ARTIFACTS: {},
      },
      {
        messages: [
          {
            body: "{",
            ack: () => {
              calls.push("ack");
            },
            retry: () => {
              calls.push("retry");
            },
          },
        ],
      },
    );
    expect(calls).toEqual(["retry"]);
  });

  it("treats instance.already_exists as the instance being present", async () => {
    const id = await startAdsSweep(
      {
        PAGE_SWEEP_MAX_CONCURRENCY: "8",
        BROWSER_CONCURRENCY_CAP: "10",
        ADS_SWEEP: {
          get: () => Promise.reject(new Error("instance.not_found")),
          create: () =>
            Promise.reject(
              Object.assign(new Error("taken"), { code: "instance.already_exists" }),
            ),
        },
      },
      Date.parse("2026-09-22T02:00:00.000Z"),
    );
    expect(id).toBe("ads-sweep-2026-09-22");
  });

  it("does not swallow a duplicate-instance error that is only prose", async () => {
    await expect(
      startAdsSweep(
        {
          PAGE_SWEEP_MAX_CONCURRENCY: "8",
        BROWSER_CONCURRENCY_CAP: "10",
          ADS_SWEEP: {
            get: () => Promise.reject(new Error("instance.not_found")),
            create: () =>
              Promise.reject(new Error('Workflow instance with id "ads-sweep-2026-09-22" already exists')),
          },
        },
        Date.parse("2026-09-22T02:00:00.000Z"),
      ),
    ).rejects.toThrow(/already exists/);
  });
});
