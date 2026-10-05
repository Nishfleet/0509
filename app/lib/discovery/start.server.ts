import { env } from "cloudflare:workers";

import { isSubscriptionLive } from "../billing/entitlements";
import { isDiscoveryDay } from "../cadence";
import { readDiscoverableWorkspaces, readOnboardingCompetitors } from "../data/entity.server";
import { discoveryStateFor, type DiscoveryState } from "./state";

export interface DiscoveryParams {
  workspaceId: string;
  mode: "create" | "refresh";
}

const BATCH_LIMIT = 100;

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

async function eligibleWorkspaceIds(now: Date, mode: "create" | "refresh"): Promise<string[]> {
  const workspaces = await readDiscoverableWorkspaces();
  return workspaces
    .filter((workspace) => isSubscriptionLive(workspace, now))
    .filter((workspace) => mode === "refresh" || isDiscoveryDay(workspace.createdAt, now))
    .map((workspace) => workspace.workspaceId);
}

async function startAll(now: Date, mode: "create" | "refresh"): Promise<number> {
  const all = instances(await eligibleWorkspaceIds(now, mode), now, mode);
  const chunks = Array.from({ length: Math.ceil(all.length / BATCH_LIMIT) }, (_, index) =>
    all.slice(index * BATCH_LIMIT, (index + 1) * BATCH_LIMIT),
  );
  for (const chunk of chunks) await env.DISCOVERY.createBatch(chunk);
  return all.length;
}

export async function startDiscovery(workspaceId: string, now: Date): Promise<string> {
  const [instance] = instances([workspaceId], now, "create");
  if (instance === undefined) throw new Error("discovery instance was not addressed");
  await env.DISCOVERY.createBatch([instance]);
  return instance.id;
}

export async function startNightlyDiscovery(now: Date): Promise<number> {
  return startAll(now, "create");
}

export async function startWeeklyRefresh(now: Date): Promise<number> {
  return startAll(now, "refresh");
}

export async function readDiscoveryState(workspaceId: string, now: Date): Promise<DiscoveryState> {
  try {
    const instance = await env.DISCOVERY.get(discoveryInstanceId(workspaceId, now, "create"));
    const { status } = await instance.status();
    return discoveryStateFor(status);
  } catch (error) {
    console.warn(JSON.stringify({ event: "discovery.status_unread", message: String(error) }));
    return "looking";
  }
}

export async function readOnboardingScreen(workspaceId: string, now: Date) {
  const discovery = await readDiscoveryState(workspaceId, now);
  const statusReadAt = new Date().toISOString();
  const competitors = await readOnboardingCompetitors(workspaceId);
  if (discovery === "done" && competitors.on.length + competitors.maybes.length === 0) {
    console.warn(
      JSON.stringify({
        event: "discovery.done_with_empty_list",
        workspaceId,
        statusReadAt,
        listsReadAt: new Date().toISOString(),
      }),
    );
  }
  return { ...competitors, discovery };
}
