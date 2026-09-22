import type { AdsSourceDescriptor } from "../app/lib/ads/descriptor";
import { watchConfigUpdate } from "../app/lib/data/watch.server";
import {
  consumeSweepMessage,
  parseSweepMessage,
  withDeadLetter,
  type SweepPull,
} from "./ads-sweep";

type SweepConsumerEnv = Pick<Env, "DB" | "CARD_ARTIFACTS" | "BROWSER">;

async function pullWithTransports(
  env: SweepConsumerEnv,
  descriptor: AdsSourceDescriptor,
  target: string,
): Promise<{ payload: unknown; status: number }> {
  if (descriptor.transport === "browser") {
    if (!env.BROWSER) {
      throw new Error("BROWSER binding is not configured");
    }
    const { transportBrowser } = await import("../app/lib/ads/transport-browser");
    return transportBrowser(descriptor, target, { BROWSER: env.BROWSER });
  }
  const { transportApi } = await import("../app/lib/ads/transport-api");
  return transportApi(descriptor, target);
}

export async function recordDeadLetter(
  env: Pick<Env, "DB" | "CARD_ARTIFACTS">,
  queue: string,
  message: { id: string; body: unknown; ack(): void },
): Promise<void> {
  const key = `ads/dlq/${queue}/${message.id}`;
  await env.CARD_ARTIFACTS.put(key, JSON.stringify(message.body));
  const parsed = parseSweepMessage(message.body);
  if (parsed) {
    const row = await env.DB.prepare("SELECT config_json FROM watch WHERE id = ?")
      .bind(parsed.watchId)
      .first<{ config_json: string }>();
    const next = row ? withDeadLetter(row.config_json, queue, message.id, parsed.tick) : null;
    if (next !== null) {
      await watchConfigUpdate(env.DB, parsed.watchId, next).run();
    }
  }
  message.ack();
}

export interface SweepDelivery {
  body: unknown;
  ack(): void;
  retry(): void;
}

export async function handleSweepBatch(
  env: SweepConsumerEnv,
  batch: { messages: Iterable<SweepDelivery> },
  pull?: SweepPull,
): Promise<void> {
  const resolve = pull ?? ((descriptor, target) => pullWithTransports(env, descriptor, target));
  for (const message of batch.messages) {
    const parsed = parseSweepMessage(message.body);
    if (!parsed) {
      message.retry();
      continue;
    }
    const outcome = await consumeSweepMessage(env.DB, env.CARD_ARTIFACTS, parsed, resolve);
    if (outcome === "retry") message.retry();
    else message.ack();
  }
}
