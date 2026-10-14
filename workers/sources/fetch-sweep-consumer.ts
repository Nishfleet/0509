import { captureException } from "@sentry/cloudflare";
import { z } from "zod";

import { deferredByTimeout } from "../../app/lib/fetch/transport.server";
import { readFailureReasonForWatch } from "../../app/lib/data/page.server";
import { readSiteSweepTarget } from "../../app/lib/data/watch.server";
import { checkSitePage, publishSiteChange, type SweepTick } from "../../app/lib/site/sweep.server";

export const FETCH_SWEEP_QUEUE = "fetch-sweep";
export const FETCH_SWEEP_DLQ = "fetch-sweep-dlq";

const fetchSweepMessage = z.object({
  watchId: z.string().min(1),
  entityId: z.string().min(1),
  sourceId: z.string().min(1),
  targetKey: z.string().min(1),
});

export type FetchSweepMessage = z.infer<typeof fetchSweepMessage>;

export type FetchSweepOutcome =
  "not_collectable" | "first" | "unchanged" | "changed" | "disallowed" | "deferred" | "failed" | "unparseable";

export function parseFetchSweepMessage(body: unknown): FetchSweepMessage | null {
  const parsed = fetchSweepMessage.safeParse(typeof body === "string" ? readJson(body) : body);
  if (!parsed.success) {
    console.error(
      JSON.stringify({
        event: "fetch-sweep.message_unparseable",
        queue: FETCH_SWEEP_QUEUE,
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      }),
    );
    return null;
  }
  return parsed.data;
}

function readJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (cause) {
    console.error(
      JSON.stringify({
        event: "fetch-sweep.message_unparseable",
        queue: FETCH_SWEEP_QUEUE,
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    );
    return null;
  }
}

async function collectWatch(message: FetchSweepMessage, tick: SweepTick): Promise<FetchSweepOutcome> {
  const target = await readSiteSweepTarget(message.watchId);
  if (target === null) {
    console.log(
      JSON.stringify({
        event: "fetch-sweep.not_collectable",
        queue: FETCH_SWEEP_QUEUE,
        watchId: message.watchId,
        entityId: message.entityId,
        sourceId: message.sourceId,
        targetKey: message.targetKey,
      }),
    );
    return "not_collectable";
  }

  const result = await checkSitePage(target, tick, { browser: false });
  if (result.outcome === "changed") {
    await publishSiteChange(target, result);
  }
  if (result.outcome === "gone") return "not_collectable";
  if (result.outcome !== "failed") return result.outcome;
  if (result.reason === "robots") return "disallowed";
  if (result.reason === "deferred") return deferredByTimeout(result.detail) ? "failed" : "deferred";

  captureException(
    new Error(
      JSON.stringify({
        event: "fetch-sweep.collect_failed",
        queue: FETCH_SWEEP_QUEUE,
        watchId: message.watchId,
        pageId: target.pageId,
        reason: result.reason,
        detail: result.detail,
      }),
    ),
    { tags: { queue: FETCH_SWEEP_QUEUE, watchId: message.watchId } },
  );
  return "failed";
}

export async function handleFetchSweepBatch(batch: MessageBatch): Promise<FetchSweepOutcome[]> {
  const plannedAt = new Date().toISOString();
  const results: FetchSweepOutcome[] = [];
  for (const item of batch.messages) {
    const parsed = parseFetchSweepMessage(item.body);
    if (parsed === null) {
      item.ack();
      results.push("unparseable");
      continue;
    }
    const outcome = await collectWatch(parsed, { instanceId: item.id, plannedAt });
    if (outcome === "failed") {
      item.retry();
    } else {
      item.ack();
    }
    results.push(outcome);
  }
  const failed = results.filter((outcome) => outcome === "failed").length;
  const unparseable = results.filter((outcome) => outcome === "unparseable").length;
  const disallowed = results.filter((outcome) => outcome === "disallowed").length;
  const deferred = results.filter((outcome) => outcome === "deferred").length;
  console.log(
    JSON.stringify({
      event: "fetch-sweep.batch",
      queue: batch.queue,
      instanceId: batch.messages[0]?.id ?? null,
      messages: batch.messages.length,
      collected: results.length - failed - unparseable - disallowed - deferred,
      deferred,
      failed,
    }),
  );
  return results;
}

export async function handleFetchSweepDlqBatch(batch: MessageBatch): Promise<void> {
  for (const item of batch.messages) {
    const parsed = parseFetchSweepMessage(item.body);
    const reason = parsed === null ? null : await readFailureReasonForWatch(parsed.watchId);
    captureException(
      new Error(
        JSON.stringify({
          event: "fetch-sweep.dead_lettered",
          queue: FETCH_SWEEP_DLQ,
          message_id: item.id,
          reason,
        }),
      ),
      { tags: { queue: FETCH_SWEEP_DLQ } },
    );
    item.ack();
  }
}
