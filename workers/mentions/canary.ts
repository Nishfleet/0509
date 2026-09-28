import { env } from "cloudflare:workers";

import type { CanarySource } from "../../app/lib/data/source.server";
import { markSourceBlocked, recordSourceCanary } from "../../app/lib/data/source.server";
import { adapterFor } from "../sources/registry";
import { UpstreamBlockedError } from "../sources/mentions/types";

export async function runCanary(source: CanarySource, now: string): Promise<number> {
  const adapter = adapterFor(source.pluginKey);
  let count = 0;
  if (adapter !== undefined) {
    try {
      const result = await adapter({ query: source.canaryQuery }, null);
      count = result.canaryCount;
    } catch (error) {
      if (error instanceof UpstreamBlockedError) {
        await markSourceBlocked(source.id, error.status);
        return 0;
      }
      count = 0;
    }
  }
  await recordSourceCanary(source.id, count, now);
  return count;
}

export function writeSourcePoint(
  pluginKey: string,
  itemCount: number,
  canaryCount: number | null,
): void {
  env.MENTIONS_SOURCES.writeDataPoint({
    blobs: [pluginKey],
    doubles: [itemCount, canaryCount ?? -1],
    indexes: [pluginKey],
  });
}
