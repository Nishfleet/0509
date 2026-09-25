import type { CanarySource } from "../../app/lib/data/source.server";
import { recordSourceCanary } from "../../app/lib/data/source.server";
import { adapterFor } from "../sources/registry";

export async function runCanary(source: CanarySource, now: string): Promise<number> {
  const adapter = adapterFor(source.pluginKey);
  let count = 0;
  if (adapter !== undefined) {
    try {
      const result = await adapter({ query: source.canaryQuery }, null);
      count = result.canaryCount;
    } catch {
      count = 0;
    }
  }
  await recordSourceCanary(source.id, count, now);
  return count;
}
