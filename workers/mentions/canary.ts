import { env } from "cloudflare:workers";

import type { CanarySource } from "../../app/lib/data/source.server";
import { markSourceBlocked, recordSourceCanary } from "../../app/lib/data/source.server";
import { adapterFor } from "../sources/registry";
import { UpstreamBlockedError } from "../sources/mentions/types";

export async function recordUpstreamBlock(sourceId: string, pluginKey: string, status: number): Promise<boolean> {
  if (status === 429) {
    console.warn(JSON.stringify({ event: "mentions.rate_limited", source: pluginKey, status }));
    return false;
  }
  await markSourceBlocked(sourceId, status);
  return true;
}

export async function runCanary(source: CanarySource, now: string): Promise<number | null> {
  const adapter = adapterFor(source.pluginKey);
  let count = 0;
  if (adapter !== undefined) {
    try {
      const result = await adapter({ query: source.canaryQuery }, null);
      count = result.canaryCount;
    } catch (error) {
      if (error instanceof UpstreamBlockedError) {
        return (await recordUpstreamBlock(source.id, source.pluginKey, error.status)) ? 0 : null;
      }
      count = 0;
    }
  }
  await recordSourceCanary(source.id, count, now);
  return count;
}

export function writeSourcePoint(pluginKey: string, itemCount: number, canaryCount: number | null): void {
  env.MENTIONS_SOURCES.writeDataPoint({
    blobs: [pluginKey],
    doubles: [itemCount, canaryCount ?? -1],
    indexes: [pluginKey],
  });
}
