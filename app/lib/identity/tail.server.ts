import { env } from "cloudflare:workers";

import { readSelfEntityId } from "../data/entity.server";
import { insertPages } from "../data/page.server";
import type { NewPage } from "../data/page.server";
import { readEnabledSourceId, readEnabledSources } from "../data/source.server";
import { insertWatches, readEntityWatches } from "../data/watch.server";
import type { NewWatch } from "../data/watch.server";
import { startDiscovery, workflowInstanceExists } from "../discovery/start.server";
import { discoverBoard } from "../hiring/discover-board";
import { readCachedSiteProof } from "./card.server";
import { normaliseSubject, type Subject } from "./normalise";

export interface IdentityTailParams {
  workspaceId: string;
  entityId: string;
  name: string;
  domain: string;
  homepageUrl: string | null;
}

export interface TailWatch {
  id: string;
  sourceId: string;
  sourceKey: string;
  targetKey: string;
}

export interface IdentityTailOutcome {
  entityId: string;
  watches: { id: string; sourceKey: string; targetKey: string }[];
  discoveryInstanceId: string | null;
  queued: string[];
  r2Keys: string[];
  siteFill: "filled" | "gave_up" | null;
}

interface AdTarget {
  sourceKey: string;
  targetKey: string;
}

export function identityTailInstanceId(entityId: string): string {
  return `identity-tail-${entityId}`;
}

export async function startIdentityTail(params: IdentityTailParams): Promise<string> {
  const id = identityTailInstanceId(params.entityId);
  try {
    await env.IDENTITY_TAIL.create({ id, params });
  } catch (error) {
    if (!workflowInstanceExists(error)) throw error;
  }
  return id;
}

export async function persistTail(params: IdentityTailParams): Promise<{ entityId: string | null }> {
  return { entityId: await readSelfEntityId(params.workspaceId, params.entityId) };
}

export async function seedTailWatches(params: IdentityTailParams, discoveredAt: string): Promise<TailWatch[]> {
  const subject = subjectFor(params);
  const proof = subject === null ? { adLibraryHints: [], navLinks: [] } : await readCachedSiteProof(subject);
  const pricing = pricingUrl(proof.navLinks);
  const ads = adTargets(proof.adLibraryHints);
  const hiring = await hiringTarget(proof.navLinks, params.domain);
  const siteSourceId = await readEnabledSourceId("site.web");
  const planned: NewWatch[] = [];
  const pages: NewPage[] = [];
  const seen = new Set<string>();
  const seenPages = new Set<string>();

  function page(url: string, role: "home" | "pricing"): void {
    if (seenPages.has(url)) return;
    seenPages.add(url);
    pages.push({ id: crypto.randomUUID(), entityId: params.entityId, url, role, discoveredAt });
  }

  function watch(sourceId: string, targetKey: string): void {
    const key = `${sourceId}\n${targetKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    planned.push({ id: crypto.randomUUID(), entityId: params.entityId, sourceId, targetKey });
  }

  if (siteSourceId !== null && params.homepageUrl !== null) {
    page(params.homepageUrl, "home");
    watch(siteSourceId, params.homepageUrl);
    if (pricing !== null && pricing !== params.homepageUrl) {
      page(pricing, "pricing");
      watch(siteSourceId, pricing);
    }
  }

  if (params.name.trim() !== "") {
    for (const source of await readEnabledSources("mentions")) watch(source.id, params.name);
  }

  for (const target of ads) {
    const sourceId = await readEnabledSourceId(target.sourceKey);
    if (sourceId !== null) watch(sourceId, target.targetKey);
  }

  if (hiring !== null) {
    const sourceId = await readEnabledSourceId(hiring.sourceKey);
    if (sourceId !== null) watch(sourceId, hiring.boardUrl);
  }

  await insertPages(pages);
  await insertWatches(planned);
  return readEntityWatches(params.entityId);
}

export async function enqueueFirstSweep(entityId: string, watches: readonly TailWatch[]): Promise<string[]> {
  if (watches.length === 0) return [];
  await env.FETCH_SWEEP.sendBatch(
    watches.map((watch) => ({
      body: {
        watchId: watch.id,
        entityId,
        sourceId: watch.sourceId,
        targetKey: watch.targetKey,
      },
    })),
  );
  return watches.map((watch) => watch.id);
}

export async function startTailDiscovery(workspaceId: string, now: Date): Promise<string> {
  return startDiscovery(workspaceId, now);
}

function subjectFor(params: IdentityTailParams): Subject | null {
  if (params.homepageUrl === null) return null;
  const normalised = normaliseSubject(params.homepageUrl);
  return normalised.ok ? normalised.subject : null;
}

function pricingUrl(links: readonly string[]): string | null {
  for (const link of links) {
    if (!URL.canParse(link)) continue;
    const url = new URL(link);
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
    if (segments.some((segment) => segment.toLowerCase() === "pricing")) return url.href;
  }
  return null;
}

function adTargets(hints: readonly string[]): AdTarget[] {
  const targets: AdTarget[] = [];
  const seen = new Set<string>();
  for (const hint of hints) {
    const target = adTarget(hint);
    if (target === null) continue;
    const key = `${target.sourceKey}\n${target.targetKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return targets;
}

function adTarget(hint: string): AdTarget | null {
  const trimmed = hint.trim();
  if (trimmed === "") return null;
  if (!URL.canParse(trimmed)) return { sourceKey: "ads.meta", targetKey: trimmed };
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const sourceKey = sourceKeyForAd(url);
  if (sourceKey === null) return null;
  return { sourceKey, targetKey: adTargetKey(url) };
}

function sourceKeyForAd(url: URL): string | null {
  if (url.hostname === "www.facebook.com" && url.pathname.startsWith("/ads/library")) return "ads.meta";
  if (url.hostname === "adstransparency.google.com") return "ads.google";
  return null;
}

function namedParam(url: URL, name: string): string | null {
  const value = url.searchParams.get(name);
  if (value === null || value.trim() === "") return null;
  return value;
}

function adTargetKey(url: URL): string {
  return (
    namedParam(url, "id") ??
    namedParam(url, "view_all_page_id") ??
    namedParam(url, "advertiser") ??
    namedParam(url, "q") ??
    url.href
  );
}

async function hiringTarget(
  links: readonly string[],
  domain: string,
): Promise<{ sourceKey: string; boardUrl: string } | null> {
  if (links.length === 0) return null;
  const board = await discoverBoard(links, domain);
  if (board.platform === "none" || board.boardUrl === null) return null;
  return { sourceKey: `hiring.${board.platform}`, boardUrl: board.boardUrl };
}
