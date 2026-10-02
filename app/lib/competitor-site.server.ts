import { getDomain } from "tldts";

import {
  SITE_INVALID_ERROR,
  SITE_LINK_MAX,
  SITE_ROBOTS_ERROR,
  SITE_SAME_ERROR,
  SITE_TOO_LONG_ERROR,
  SITE_TOO_MANY_ERROR,
  SITE_UNREADABLE_ERROR,
  SITE_WAIT_ERROR,
} from "./competitor-site";
import { readCompetitor } from "./data/entity.server";
import { insertAlternatePage } from "./data/page.server";
import { readEnabledSourceId } from "./data/source.server";
import { readCustomerSiteUsage, recordAlternateAttempt, retireCustomerSites } from "./data/watch.server";
import { cappedText, fetchOutbound, targetRefusal } from "./fetch/outbound.server";
import { CRAWLER_USER_AGENT, robotsAllows } from "./fetch/robots.server";
import { refusalReason } from "./fetch/transport.server";

const MAX_PAGE_BYTES = 5_000_000;
const COOLDOWN_MS = 60_000;
const MAX_SITES_PER_COMPETITOR = 5;
const FETCH_HEADERS = { accept: "text/html,application/xhtml+xml", "user-agent": CRAWLER_USER_AGENT } as const;

type Refusal = { ok: false; message: string };

export function parseSiteInput(raw: string, brandDomain: string): { ok: true; url: string } | Refusal {
  const trimmed = raw.trim();
  if (trimmed.length > SITE_LINK_MAX) return { ok: false, message: SITE_TOO_LONG_ERROR };
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!URL.canParse(candidate)) return { ok: false, message: SITE_INVALID_ERROR };
  const url = new URL(candidate);
  if (url.username !== "" || url.password !== "" || targetRefusal(url) !== null) {
    return { ok: false, message: SITE_INVALID_ERROR };
  }
  if (getDomain(url.href) === getDomain(brandDomain)) return { ok: false, message: SITE_SAME_ERROR };
  url.protocol = "https:";
  url.port = "";
  return { ok: true, url: `${url.origin}${url.pathname}` };
}

async function readSite(url: string, brandDomain: string): Promise<{ ok: true } | Refusal> {
  if (!(await robotsAllows(url))) return { ok: false, message: SITE_ROBOTS_ERROR };
  try {
    const res = await fetchOutbound(url, { headers: FETCH_HEADERS });
    const html = await cappedText(res, MAX_PAGE_BYTES);
    if (html === null || (await refusalReason(res.status, html)) !== null) {
      return { ok: false, message: SITE_UNREADABLE_ERROR };
    }
    if (res.url === "" || res.url === url) return { ok: true };
    if (getDomain(res.url) === getDomain(brandDomain)) return { ok: false, message: SITE_SAME_ERROR };
    return (await robotsAllows(res.url)) ? { ok: true } : { ok: false, message: SITE_ROBOTS_ERROR };
  } catch (error) {
    console.log(
      JSON.stringify({ event: "competitor-site.read_failed", error: error instanceof Error ? error.name : "unknown" }),
    );
    return { ok: false, message: SITE_UNREADABLE_ERROR };
  }
}

async function throttled(workspaceId: string, entityId: string, now: number): Promise<Refusal | null> {
  const usage = await readCustomerSiteUsage(workspaceId, entityId);
  if (usage.lastAt !== null && now - Date.parse(usage.lastAt) < COOLDOWN_MS) {
    return { ok: false, message: SITE_WAIT_ERROR };
  }
  return usage.rows >= MAX_SITES_PER_COMPETITOR ? { ok: false, message: SITE_TOO_MANY_ERROR } : null;
}

export async function saveCompetitorSite(
  workspaceId: string,
  entityId: string,
  raw: string,
): Promise<{ ok: true } | Refusal> {
  const competitor = await readCompetitor(workspaceId, entityId);
  const sourceId = await readEnabledSourceId("site.web");
  if (competitor === null || sourceId === null) return { ok: false, message: "We don't track that competitor." };
  const parsed = parseSiteInput(raw, competitor.domain);
  if (!parsed.ok) return parsed;
  const blocked = await throttled(workspaceId, entityId, Date.now());
  if (blocked !== null) return blocked;
  const read = await readSite(parsed.url, competitor.domain);
  if (!read.ok) return read;
  const at = new Date().toISOString();
  await recordAlternateAttempt({
    entityId,
    sourceId,
    url: parsed.url,
    at,
    outcome: { adopted: true },
    origin: "customer",
  });
  await insertAlternatePage({ entityId, url: parsed.url, role: "other", transport: "fetch", at });
  await retireCustomerSites(workspaceId, entityId, parsed.url);
  return { ok: true };
}
