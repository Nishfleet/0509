import { env } from "cloudflare:workers";

import { insertIncidentAlertStatement } from "../data/alert.server";
import {
  closeIncident,
  closeIncidentsOutside,
  openIncident,
  readOpenBreakageBaselines,
  readOpenIncidents,
} from "../data/incident.server";
import { readPaidWorkspaceIds } from "../data/plan.server";
import type { OwnSitePage } from "../data/page.server";
import { readOwnSitePages } from "../data/page.server";
import { readWorkspaceEntitlements } from "../data/plan.server";
import { BlockedRedirectError, fetchOutbound } from "../fetch/outbound.server";
import { robotsAllows } from "../fetch/robots.server";
import { PROBE_HEADERS, PROBE_TIMEOUT_MS } from "./breakage-recheck.server";
import { ensureHomePages } from "./sweep.server";

export type OwnSiteHealth =
  | { state: "healthy" }
  | { state: "unknown"; reason: string }
  | { state: "broken"; kind: string };

export interface OwnSitePlan {
  pages: OwnSitePage[];
  openIncidents: Record<string, string>;
  breakage: Record<string, string | null>;
}

async function fetchStatus(url: string): Promise<Response | Error> {
  try {
    const response = await fetchOutbound(url, {
      headers: PROBE_HEADERS,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function wwwVariant(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.startsWith("www.") ? parsed.hostname.slice("www.".length) : `www.${parsed.hostname}`;
  return `${parsed.protocol}//${host}${parsed.pathname}`;
}

async function fetchTwin(url: string): Promise<Response | Error | "robots"> {
  const twin = wwwVariant(url);
  return (await robotsAllows(twin)) ? fetchStatus(twin) : "robots";
}

export function pageHost(url: string): string {
  return new URL(url).hostname;
}

export async function probeOwnSite(url: string): Promise<OwnSiteHealth> {
  if (!(await robotsAllows(url))) return { state: "unknown", reason: "robots" };
  const first = await fetchStatus(url);
  if (first instanceof BlockedRedirectError) return { state: "unknown", reason: "redirect refused" };
  const response = first instanceof Error ? await fetchTwin(url) : first;
  if (response === "robots") return { state: "unknown", reason: "robots" };
  return classify(response);
}

function classify(response: Response | Error): OwnSiteHealth {
  if (response instanceof Error) return { state: "broken", kind: "not loading" };
  if (response.headers.get("cf-mitigated") === "challenge") return { state: "unknown", reason: "challenge" };
  if (response.status >= 500 || response.status === 404 || response.status === 410) {
    return { state: "broken", kind: `error ${String(response.status)}` };
  }
  if (response.status >= 400) return { state: "unknown", reason: `status ${String(response.status)}` };
  return { state: "healthy" };
}

async function entitledOwnSitePages(pages: OwnSitePage[]): Promise<OwnSitePage[]> {
  const entitlements = await readWorkspaceEntitlements(pages.map((page) => page.workspaceId));
  return pages.filter((page) => entitlements.get(page.workspaceId)?.own_site_alerts === true);
}

export async function planOwnSiteCheck(now: string): Promise<OwnSitePlan> {
  await ensureHomePages(now);
  const paid = await readPaidWorkspaceIds(new Date(now));
  const pages = await entitledOwnSitePages((await readOwnSitePages()).filter((page) => paid.has(page.workspaceId)));
  await closeIncidentsOutside(
    pages.map((page) => page.pageId),
    now,
  );
  return {
    pages,
    openIncidents: await readOpenIncidents(),
    breakage: await readOpenBreakageBaselines(),
  };
}

export async function openOwnSiteIncident(page: OwnSitePage, kind: string): Promise<string | null> {
  const openedAt = new Date().toISOString();
  const incidentId = await openIncident({
    id: crypto.randomUUID(),
    workspaceId: page.workspaceId,
    entityId: page.entityId,
    pageId: page.pageId,
    kind,
    openedAt,
  });
  if (incidentId === null) return null;
  await insertIncidentAlertStatement({
    id: `incident-${incidentId}`,
    workspaceId: page.workspaceId,
    entityId: page.entityId,
    pageId: page.pageId,
    signalId: null,
    incidentId,
    severity: "high",
    title: `${pageHost(page.url)} looks broken: ${kind}`,
    body: null,
    createdAt: openedAt,
  }).run();
  await env.SEND_EMAIL.send({ incident_id: incidentId });
  return incidentId;
}

export async function closeOwnSiteIncident(incidentId: string): Promise<void> {
  await closeIncident(incidentId, new Date().toISOString());
  await env.SEND_EMAIL.send({ incident_id: incidentId });
}
