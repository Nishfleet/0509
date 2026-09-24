import {
  ensureAdlibWatch,
  insertAdlibSnapshot,
  readAdlibSelf,
  readAdlibSnapshot,
} from "../data/adlib.server";
import { adlibQuery, candidatesFromAdLibrary, parseStoredCandidates, serializeStored } from "./generators/meta-adlib";
import type { AdlibQuery } from "./generators/meta-adlib";
import { readAdlibPayload, writeAdlibPayload } from "./meta-adlib-store.server";
import type { Candidate } from "./types";

export interface AdlibPage {
  status: number;
  html: string;
  searchUrl: string;
}

export interface AdlibArrival {
  snapshotId: string;
  fetchedAt: string;
  enqueuedAt: string;
  candidates: Candidate[];
  skipped: boolean;
}

function snapshotIdFor(workspaceId: string, enqueuedAt: string): string {
  return `adlib-${workspaceId}-${enqueuedAt}`;
}

function payloadKey(snapshotId: string): string {
  return `snapshot/discovery/${snapshotId}.json`;
}

function htmlKey(snapshotId: string): string {
  return `snapshot/discovery/${snapshotId}.html`;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function usable(page: AdlibPage): boolean {
  return page.status >= 200 && page.status <= 299 && !page.html.includes("__rd_verify");
}

export async function runMetaAdlib(input: {
  workspaceId: string;
  enqueuedAt: string;
  now?: Date;
  pull: (query: AdlibQuery) => Promise<AdlibPage>;
}): Promise<AdlibArrival | null> {
  const snapshotId = snapshotIdFor(input.workspaceId, input.enqueuedAt);
  const existing = await readAdlibSnapshot(snapshotId);
  if (existing !== null) {
    const body = existing.payloadR2Key === null ? null : await readAdlibPayload(existing.payloadR2Key);
    return {
      snapshotId,
      fetchedAt: existing.fetchedAt,
      enqueuedAt: input.enqueuedAt,
      candidates: body === null ? [] : parseStoredCandidates(body),
      skipped: true,
    };
  }

  const self = await readAdlibSelf(input.workspaceId);
  if (self === null) return null;

  const fetchedAt = (input.now ?? new Date()).toISOString();
  const query = adlibQuery(self);
  const targetKey = query === null ? "unspecified" : `${query.category}|${query.market}`;
  const watchId = await ensureAdlibWatch(self.id, targetKey);

  let status = 0;
  let html = "";
  let searchUrl: string | null = null;
  let candidates: Candidate[] = [];
  if (query !== null) {
    const page = await input.pull(query);
    status = page.status;
    html = page.html;
    searchUrl = page.searchUrl;
    if (usable(page)) candidates = candidatesFromAdLibrary(html, query, self.name);
  }

  const key = payloadKey(snapshotId);
  const stored = serializeStored({
    enqueuedAt: input.enqueuedAt,
    fetchedAt,
    category: query?.category ?? null,
    market: query?.market ?? null,
    searchUrl,
    status,
    candidates,
  });
  await writeAdlibPayload(key, stored);
  if (html.length > 0) await writeAdlibPayload(htmlKey(snapshotId), html);
  await insertAdlibSnapshot({
    id: snapshotId,
    watchId,
    fetchedAt,
    r2Key: key,
    hash: await sha256(html.length > 0 ? html : stored),
    itemCount: candidates.length,
  });
  console.log(
    JSON.stringify({
      event: "discovery.meta_adlib",
      workspaceId: input.workspaceId,
      snapshotId,
      itemCount: candidates.length,
      status,
    }),
  );
  return { snapshotId, fetchedAt, enqueuedAt: input.enqueuedAt, candidates, skipped: false };
}
