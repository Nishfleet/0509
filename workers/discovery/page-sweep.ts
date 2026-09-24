import { pullMetaAdlib } from "../../app/lib/discovery/meta-adlib-browser.server";
import { parseMetaAdlibMessage } from "../../app/lib/discovery/meta-adlib-enqueue.server";
import { runMetaAdlib } from "../../app/lib/discovery/meta-adlib-run.server";

export async function handlePageSweep(batch: MessageBatch): Promise<void> {
  for (const item of batch.messages) {
    const parsed = parseMetaAdlibMessage(item.body);
    if (parsed === null) {
      console.error(JSON.stringify({ event: "page-sweep.unrecognised", id: item.id }));
      item.ack();
      continue;
    }
    try {
      await runMetaAdlib({
        workspaceId: parsed.workspaceId,
        enqueuedAt: parsed.enqueuedAt,
        pull: pullMetaAdlib,
      });
      item.ack();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "discovery.meta_adlib_failed",
          id: item.id,
          message: error instanceof Error ? error.message : "failed",
        }),
      );
      item.retry();
    }
  }
}

export function handlePageSweepDlq(batch: MessageBatch): void {
  for (const item of batch.messages) {
    console.error(JSON.stringify({ event: "page-sweep.dlq", id: item.id }));
    item.ack();
  }
}
