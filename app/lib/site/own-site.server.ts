import { env } from "cloudflare:workers";

import { insertIncidentAlert } from "../data/alert.server";
import { closeIncident, openIncident, readOpenIncidents } from "../data/incident.server";
import type { SiteSweepTarget } from "../data/watch.server";
import { readUrl } from "../fetch/transport.server";
import { planSiteSweep } from "./sweep.server";

export type OwnSiteHealth = { healthy: true } | { healthy: false; kind: string };

export interface OwnSitePlan {
  pages: SiteSweepTarget[];
  openIncidents: Record<string, string>;
}

export async function planOwnSiteCheck(now: string): Promise<OwnSitePlan> {
  const targets = await planSiteSweep(now);
  return {
    pages: targets.filter((target) => target.entityRole === "self"),
    openIncidents: await readOpenIncidents(),
  };
}

export async function probeOwnSite(url: string): Promise<OwnSiteHealth> {
  const read = await readUrl(url);
  if (!read.ok) return { healthy: false, kind: "not loading" };
  if (read.status >= 400) return { healthy: false, kind: `error ${String(read.status)}` };
  return { healthy: true };
}

export async function openOwnSiteIncident(target: SiteSweepTarget, kind: string): Promise<string | null> {
  const openedAt = new Date().toISOString();
  const incidentId = await openIncident({
    id: crypto.randomUUID(),
    workspaceId: target.workspaceId,
    entityId: target.entityId,
    pageId: target.pageId,
    kind,
    openedAt,
  });
  if (incidentId === null) return null;
  await insertIncidentAlert(env.DB, {
    incidentId,
    workspaceId: target.workspaceId,
    entityId: target.entityId,
    pageId: target.pageId,
    title: `${target.domain} looks broken: ${kind}`,
    createdAt: openedAt,
  });
  await env.SEND_EMAIL.send({ incident_id: incidentId });
  return incidentId;
}

export async function closeOwnSiteIncident(incidentId: string): Promise<void> {
  await closeIncident(incidentId, new Date().toISOString());
  await env.SEND_EMAIL.send({ incident_id: incidentId });
}
