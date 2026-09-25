import { env } from "cloudflare:workers";

import { readSelfWorkspaceIds } from "../data/entity.server";

export interface DiscoveryParams {
  workspaceId: string;
  mode: "create" | "refresh";
}

const BATCH_LIMIT = 100;

export const WEEKLY_REFRESH_CRON = "0 4 * * 1";

const ACTIVE = new Set(["queued", "running", "waiting", "waitingForPause"]);

function discoveryInstanceId(workspaceId: string, now: Date, mode: "create" | "refresh"): string {
  const date = now.toISOString().slice(0, 10);
  return mode === "refresh" ? `refresh-${workspaceId}-${date}` : `discovery-${workspaceId}-${date}`;
}

function instances(workspaceIds: readonly string[], now: Date, mode: "create" | "refresh") {
  return workspaceIds.map((workspaceId) => ({
    id: discoveryInstanceId(workspaceId, now, mode),
    params: { workspaceId, mode } satisfies DiscoveryParams,
  }));
}

async function startAll(now: Date, mode: "create" | "refresh"): Promise<number> {
  const all = instances(await readSelfWorkspaceIds(), now, mode);
  const chunks = Array.from({ length: Math.ceil(all.length / BATCH_LIMIT) }, (_, index) =>
    all.slice(index * BATCH_LIMIT, (index + 1) * BATCH_LIMIT),
  );
  for (const chunk of chunks) await env.DISCOVERY.createBatch(chunk);
  return all.length;
}

export function workflowInstanceExists(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("already exist") || message.includes("already_exists");
}

export async function startDiscovery(workspaceId: string, now: Date): Promise<string> {
  const [instance] = instances([workspaceId], now, "create");
  if (instance === undefined) throw new Error("discovery instance was not addressed");
  try {
    await env.DISCOVERY.createBatch([instance]);
  } catch (error) {
    if (!workflowInstanceExists(error)) throw error;
  }
  return instance.id;
}

export async function startNightlyDiscovery(now: Date): Promise<number> {
  return startAll(now, "create");
}

export async function startWeeklyRefresh(now: Date): Promise<number> {
  return startAll(now, "refresh");
}

export async function isDiscoveryActive(workspaceId: string, now: Date): Promise<boolean> {
  try {
    const instance = await env.DISCOVERY.get(discoveryInstanceId(workspaceId, now, "create"));
    const { status } = await instance.status();
    return ACTIVE.has(status);
  } catch (error) {
    console.warn(JSON.stringify({ event: "discovery.status_unread", message: String(error) }));
    return false;
  }
}
