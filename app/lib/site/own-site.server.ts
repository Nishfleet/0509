import { env } from "cloudflare:workers";
import { getDomain } from "tldts";

import { insertIncidentAlertStatement } from "../data/alert.server";
import { closeIncident, closeIncidentsOutside, openIncident, readOpenBreakageBaselines, readOpenIncidents } from "../data/incident.server";
import type { OwnSitePage } from "../data/page.server";
import { readOwnSitePages } from "../data/page.server";
import { computeBreakageEvidence } from "./breakage-evidence";
import { extractPageText } from "./extract-text";
import { ensureHomePages } from "./sweep.server";
import { robotsAllows } from "../fetch/robots.server";

export type OwnSiteHealth =
  | { state: "healthy" }
  | { state: "unknown"; reason: string }
  | { state: "broken"; kind: string };

export interface OwnSitePlan {
  pages: OwnSitePage[];
  openIncidents: Record<string, string>;
  breakage: Record<string, string | null>;
}

const PROBE_TIMEOUT_MS = 10_000;

const PROBE_HEADERS = {
  accept: "text/html,application/xhtml+xml",
  "user-agent": "FiveToNineBot/1.0 (+https://0509.io)",
} as const;

async function fetchStatus(url: string): Promise<Response | Error> {
  try {
    const response = await fetch(url, {
      headers: PROBE_HEADERS,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function alternateHost(url: string): string | null {
  const parsed = new URL(url);
  const registrable = getDomain(parsed.hostname);
  if (registrable === null) return null;
  const twin =
    parsed.hostname === registrable
      ? `www.${registrable}`
      : parsed.hostname === `www.${registrable}`
        ? registrable
        : null;
  return twin === null ? null : `${parsed.protocol}//${twin}${parsed.pathname}`;
}

export function pageHost(url: string): string {
  return new URL(url).hostname;
}

export async function probeOwnSite(url: string): Promise<OwnSiteHealth> {
  if (!(await robotsAllows(url))) return { state: "unknown", reason: "robots" };
  const first = await fetchStatus(url);
  const alternate = first instanceof Error ? alternateHost(url) : null;
  const response = alternate === null ? first : await fetchStatus(alternate);
  if (response instanceof Error) return { state: "broken", kind: "not loading" };
  if (response.headers.get("cf-mitigated") === "challenge") return { state: "unknown", reason: "challenge" };
  if (response.status >= 500 || response.status === 404 || response.status === 410) {
    return { state: "broken", kind: `error ${String(response.status)}` };
  }
  if (response.status >= 400) return { state: "unknown", reason: `status ${String(response.status)}` };
  return { state: "healthy" };
}

export async function breakageRepaired(url: string, beforeKey: string | null): Promise<boolean> {
  if (beforeKey === null) return false;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: PROBE_HEADERS,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "site.own_check_verify_failed",
      url,
      error: error instanceof Error ? error.message : String(error),
    }));
    return false;
  }
  const afterText = (await extractPageText(await response.text())).text;
  const before = await env.SNAPSHOTS.get(beforeKey);
  if (before === null) return false;
  const e = computeBreakageEvidence({
    status: response.status,
    beforeText: await before.text(),
    afterText,
  });
  return !e.httpError && !e.textHalved && !e.pricesVanished;
}

export async function planOwnSiteCheck(now: string): Promise<OwnSitePlan> {
  await ensureHomePages(now);
  const pages = await readOwnSitePages();
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
