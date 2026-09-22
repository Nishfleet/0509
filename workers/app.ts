import { createRequestHandler } from "react-router";

import { pingLiveness } from "../app/lib/liveness-ping.server";
import {
  FETCH_SWEEP_DLQ,
  FETCH_SWEEP_QUEUE,
  PAGE_SWEEP_DLQ,
  PAGE_SWEEP_QUEUE,
  assertBrowserCap,
} from "./ads-cap";
import { handleBatch } from "./delivery/consumer";
import { handleSweepBatch, recordDeadLetter } from "./queue-consumers";
import { ADS_SWEEP_CRON, startAdsSweep } from "./schedule";

export { AdsSweepWorkflow } from "./ads-sweep-workflow";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },

  scheduled(controller, env, ctx) {
    const ping = pingLiveness();
    if (ping) ctx.waitUntil(ping);
    if (controller.cron === ADS_SWEEP_CRON) {
      assertBrowserCap(
        Number(env.PAGE_SWEEP_MAX_CONCURRENCY),
        Number(env.BROWSER_CONCURRENCY_CAP),
      );
      ctx.waitUntil(startAdsSweep(env, controller.scheduledTime));
    }
  },

  async queue(batch: MessageBatch, env: Env) {
    if (batch.queue === PAGE_SWEEP_DLQ || batch.queue === FETCH_SWEEP_DLQ) {
      for (const message of batch.messages) {
        await recordDeadLetter(env, batch.queue, message);
      }
      return;
    }
    if (batch.queue === PAGE_SWEEP_QUEUE || batch.queue === FETCH_SWEEP_QUEUE) {
      await handleSweepBatch(env, batch);
      return;
    }
    await handleBatch(env, batch);
  },
} satisfies ExportedHandler<Env>;
