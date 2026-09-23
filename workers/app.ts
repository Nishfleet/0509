import { createRequestHandler } from "react-router";

import { pingLiveness } from "../app/lib/liveness-ping.server";
import { handleBatch } from "./delivery/consumer";

export {
  D3_QUESTION_ID,
  D6_QUESTION_ID,
  scoreByEntity,
  weightsAsOf,
  type BucketCount,
  type Reliability,
  type ScoreBucket,
  type WeightRow,
} from "./standing/score";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },

  scheduled(_controller, _env, ctx) {
    const ping = pingLiveness();
    if (ping) ctx.waitUntil(ping);
  },

  async queue(batch: MessageBatch, env: Env) {
    await handleBatch(env, batch);
  },
} satisfies ExportedHandler<Env>;
