import { createRequestHandler } from "react-router";

import { pingLiveness } from "../app/lib/liveness-ping.server";
import { consumeMention, isMentionMessage, markMentionDlq } from "./mentions/consumer";
import { enqueueMentionsTick } from "./mentions/tick";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export { MentionsJudgeWorkflow } from "./workflows/mentions-judge";

export default {
  async fetch(request) {
    return requestHandler(request);
  },

  scheduled(controller, env, ctx) {
    if (controller.cron === "17 2 * * *") {
      ctx.waitUntil(enqueueMentionsTick(env));
      return;
    }
    // The dead-man ping: an external service alerts when the reports stop,
    // which is the one failure a Worker cannot report about itself.
    const ping = pingLiveness();
    if (ping) ctx.waitUntil(ping);
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      if (!isMentionMessage(message.body)) {
        message.ack();
        continue;
      }
      try {
        if (batch.queue === "mentions-dlq") await markMentionDlq(env, message.body);
        else await consumeMention(env, message.body);
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;
