import { env } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { readSelfEntityId } from "../data/entity.server";
import { insertPages, readJudgedPricingUrl } from "../data/page.server";
import type { NewPage } from "../data/page.server";
import { readEnabledSourceId, readEnabledSources } from "../data/source.server";
import { insertWatches, readEntityWatches } from "../data/watch.server";
import type { EntityWatch, NewWatch } from "../data/watch.server";
import { readUrl, probeFailureReason } from "../fetch/transport.server";
import { discoverBoard } from "../hiring/discover-board.server";
import { sha256Hex } from "../sha256";
import { brandBudget, readCachedSiteProof, readSiteCard } from "./card.server";
import { extractIdentity } from "./extract";
import { normaliseSubject, type Subject } from "./normalise";
import { classifyNavPages } from "./page-role.server";

export interface IdentityTailParams {
  workspaceId: string;
  entityId: string;
  name: string;
  domain: string;
  homepageUrl: string | null;
  handle?: string;
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
  await env.IDENTITY_TAIL.createBatch([{ id, params }]);
  return id;
}

export async function persistTail(params: IdentityTailParams): Promise<{ entityId: string }> {
  const entityId = await readSelfEntityId(params.workspaceId, params.entityId);
  if (entityId === null) {
    throw new NonRetryableError(`self entity ${params.entityId} is not in workspace ${params.workspaceId}`);
  }
  return { entityId };
}

export async function classifyTailPages(params: IdentityTailParams, now: string): Promise<void> {
  if (params.handle !== undefined || params.homepageUrl === null) return;
  try {
    const page = await readUrl(params.homepageUrl, { mayEscalate: brandBudget(params.workspaceId, params.domain) });
    if (!page.ok) {
      const subjectSha256 = await sha256Hex(params.domain);
      console.log(
        JSON.stringify({
          event: "identity-page-role-skipped",
          workspaceId: params.workspaceId,
          reason: page.reason,
          subjectSha256,
        }),
      );
      return;
    }
    const extract = await extractIdentity(page.html, params.homepageUrl);
    await classifyNavPages({
      workspaceId: params.workspaceId,
      entity: { id: params.entityId, domain: params.domain },
      pages: extract.navPages,
      now,
    });
  } catch (error) {
    const subjectSha256 = await sha256Hex(params.domain);
    console.log(
      JSON.stringify({
        event: "identity-page-role-skipped",
        workspaceId: params.workspaceId,
        reason: probeFailureReason(error),
        subjectSha256,
      }),
    );
  }
}

export async function warmTailSiteCard(params: IdentityTailParams): Promise<void> {
  if (params.handle === undefined) return;
  const subject = subjectFor(params);
  if (subject?.kind !== "domain") return;
  await readSiteCard(subject, brandBudget(params.workspaceId, subject.registrable));
}

interface WatchTarget {
  sourceId: string;
  targetKey: string;
}

function siteTargets(params: IdentityTailParams, siteSourceId: string | null, pricing: string | null): WatchTarget[] {
  if (siteSourceId === null || params.homepageUrl === null) return [];
  const home = { sourceId: siteSourceId, targetKey: params.homepageUrl };
  return pricing !== null && pricing !== params.homepageUrl
    ? [home, { sourceId: siteSourceId, targetKey: pricing }]
    : [home];
}

async function mentionTargets(params: IdentityTailParams): Promise<WatchTarget[]> {
  const sources = await readEnabledSources("mentions");
  const named =
    params.name.trim() === "" ? [] : sources.map((source) => ({ sourceId: source.id, targetKey: params.name }));
  const handled =
    params.handle === undefined
      ? []
      : sources
          .filter((source) => source.key !== "youtube.channel_rss")
          .map((source) => ({ sourceId: source.id, targetKey: `@${String(params.handle)}` }));
  return [...named, ...handled];
}

async function enabledTargets(items: readonly AdTarget[]): Promise<WatchTarget[]> {
  const targets: WatchTarget[] = [];
  for (const item of items) {
    const sourceId = await readEnabledSourceId(item.sourceKey);
    if (sourceId !== null) targets.push({ sourceId, targetKey: item.targetKey });
  }
  return targets;
}

function uniqueTargets(targets: readonly WatchTarget[]): WatchTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.sourceId}\n${target.targetKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function seedTailWatches(params: IdentityTailParams, discoveredAt: string): Promise<EntityWatch[]> {
  const subject = subjectFor(params);
  const proof = subject === null ? { adLibraryHints: [], navLinks: [] } : await readCachedSiteProof(subject);
  const pricing = await readJudgedPricingUrl(params.entityId);
  const ads = adTargets(proof.adLibraryHints);
  const hiring = await hiringTarget(proof.navLinks, params.domain);
  const siteSourceId = await readEnabledSourceId("site.web");
  const targets = [
    ...siteTargets(params, siteSourceId, pricing),
    ...(await mentionTargets(params)),
    ...(await enabledTargets(ads)),
    ...(await enabledTargets(hiring === null ? [] : [{ sourceKey: hiring.sourceKey, targetKey: hiring.boardUrl }])),
  ];
  const pages: NewPage[] =
    siteSourceId !== null && params.homepageUrl !== null
      ? [{ id: crypto.randomUUID(), entityId: params.entityId, url: params.homepageUrl, role: "home", discoveredAt }]
      : [];
  const planned: NewWatch[] = uniqueTargets(targets).map((target) => ({
    id: crypto.randomUUID(),
    entityId: params.entityId,
    ...target,
  }));

  await insertPages(pages);
  await insertWatches(planned);
  return readEntityWatches(params.entityId);
}

export async function enqueueFirstSweep(entityId: string, watches: readonly EntityWatch[]): Promise<string[]> {
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

function subjectFor(params: IdentityTailParams): Subject | null {
  if (params.homepageUrl === null) return null;
  const normalised = normaliseSubject(params.homepageUrl);
  return normalised.ok ? normalised.subject : null;
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
