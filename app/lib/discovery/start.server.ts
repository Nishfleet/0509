import { env } from "cloudflare:workers";

import { readSelfWorkspaceIds } from "../data/entity.server";

export interface DiscoveryParams {
  workspaceId: string;
}

const BATCH_LIMIT = 100;

const ACTIVE = new Set(["queued", "running", "waiting", "waitingForPause"]);

function discoveryInstanceId(workspaceId: string, now: Date): string {
  return `discovery-${workspaceId}-${now.toISOString().slice(0, 10)}`;
}

function instances(workspaceIds: readonly string[], now: Date) {
  return workspaceIds.map((workspaceId) => ({
    id: discoveryInstanceId(workspaceId, now),
    params: { workspaceId } satisfies DiscoveryParams,
  }));
}

export async function startDiscovery(workspaceId: string, now: Date): Promise<void> {
  await env.DISCOVERY.createBatch(instances([workspaceId], now));
}

export async function startNightlyDiscovery(now: Date): Promise<number> {
  const all = instances(await readSelfWorkspaceIds(), now);
  const chunks = Array.from({ length: Math.ceil(all.length / BATCH_LIMIT) }, (_, index) =>
    all.slice(index * BATCH_LIMIT, (index + 1) * BATCH_LIMIT),
  );
  for (const chunk of chunks) await env.DISCOVERY.createBatch(chunk);
  return all.length;
}

export async function isDiscoveryActive(workspaceId: string, now: Date): Promise<boolean> {
  try {
    const instance = await env.DISCOVERY.get(discoveryInstanceId(workspaceId, now));
    const { status } = await instance.status();
    return ACTIVE.has(status);
  } catch (error) {
    console.warn(JSON.stringify({ event: "discovery.status_unread", message: String(error) }));
    return false;
  }
}
