import { z } from "zod";

import { parseAdsDescriptor, type AdsSourceDescriptor } from "../../ads/descriptor";
import type { Candidate, Evidence } from "../types";

const LIBRARY = "https://www.facebook.com/ads/library/";
const RECORD = "https://www.facebook.com/ads/library/?id=";
const COUNTRY = /^[A-Za-z]{2}$/;
const NAME_NEAR = 700;
const MAX_CANDIDATES = 30;
const NAME_PATTERN = /"(?:page_name|pageName)"\s*:\s*"((?:\\.|[^"\\])*)"/g;
const ID_PATTERN = /"(?:ad_archive_id|adArchiveID)"\s*:\s*"(\d+)"/g;
const ANCHOR_PATTERN =
  /<a\b[^>]*href="https:\/\/www\.facebook\.com\/ads\/library\/\?id=(\d+)"[^>]*>([^<]{1,80})<\/a>/gi;

const CHROME = new Set([
  "sponsored",
  "see ad details",
  "see summary details",
  "active",
  "inactive",
]);

export interface AdlibCard {
  category: string | null;
  description: string | null;
  market: string | null;
}

export interface AdlibQuery {
  category: string;
  market: string;
}

export interface StoredAdlib {
  enqueuedAt: string;
  fetchedAt: string;
  category: string | null;
  market: string | null;
  searchUrl: string | null;
  status: number;
  candidates: Candidate[];
}

interface Mark {
  at: number;
  value: string;
}

interface RecordHit {
  name: string;
  id: string;
}

const STORED = z.object({
  candidates: z.array(
    z.object({
      name: z.string(),
      domain: z.string().optional(),
      evidence: z.array(
        z.object({
          sourceUrl: z.string(),
          excerpt: z.string(),
          generator: z.literal("ads"),
        }),
      ),
    }),
  ),
});

function text(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 180);
}

export function adlibQuery(card: AdlibCard): AdlibQuery | null {
  const category = text(card.category) ?? text(card.description);
  if (category === null) return null;
  const raw = card.market?.trim() ?? "";
  const market = COUNTRY.test(raw) ? raw.toUpperCase() : "ALL";
  return { category, market };
}

export function metaAdlibDescriptor(market: string): AdsSourceDescriptor {
  return parseAdsDescriptor({
    transport: "browser",
    endpoint: `${LIBRARY}?active_status=all&ad_type=all&country=${market}&media_type=all&search_type=keyword_unordered&q={target}`,
    waitForSelector: 'a[href*="/ads/library/?id="]',
    rateLimitPerMinute: 8,
    reliability: "scraped_page",
  });
}

function nameKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanName(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    })
    .replace(/\\n/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\s+/g, " ")
    .trim();
}

function marks(html: string, pattern: RegExp): Mark[] {
  const found: Mark[] = [];
  for (const match of html.matchAll(pattern)) {
    const value = match[1];
    if (value === undefined || match.index === undefined) continue;
    found.push({ at: match.index, value });
  }
  return found;
}

function pairRecords(html: string): RecordHit[] {
  const names = marks(html, NAME_PATTERN);
  const ids = marks(html, ID_PATTERN);
  const pairs: RecordHit[] = [];
  const used = new Set<number>();
  for (const id of ids) {
    let best: { index: number; distance: number } | null = null;
    for (const [index, name] of names.entries()) {
      if (used.has(index)) continue;
      const distance = Math.abs(name.at - id.at);
      if (distance > NAME_NEAR) continue;
      if (best === null || distance < best.distance) best = { index, distance };
    }
    if (best === null) continue;
    used.add(best.index);
    const name = names[best.index];
    if (name === undefined) continue;
    const cleaned = cleanName(name.value);
    if (cleaned.length === 0 || cleaned.length > 80) continue;
    pairs.push({ name: cleaned, id: id.value });
  }
  return pairs;
}

function anchorRecords(html: string): RecordHit[] {
  const found: RecordHit[] = [];
  for (const match of html.matchAll(ANCHOR_PATTERN)) {
    const id = match[1];
    const raw = match[2];
    if (id === undefined || raw === undefined) continue;
    const name = raw.replace(/\s+/g, " ").trim();
    if (name.length === 0 || CHROME.has(name.toLowerCase())) continue;
    found.push({ name, id });
  }
  return found;
}

function evidenceFor(name: string, id: string, query: AdlibQuery): Evidence {
  return {
    sourceUrl: `${RECORD}${id}`,
    excerpt: `${name} advertises in ${query.market} for ${query.category}`,
    generator: "ads",
  };
}

export function candidatesFromAdLibrary(html: string, query: AdlibQuery, selfName: string): Candidate[] {
  const paired = pairRecords(html);
  const records = paired.length > 0 ? paired : anchorRecords(html);
  const self = nameKey(selfName);
  const merged = new Map<string, { name: string; evidence: Evidence[] }>();
  for (const record of records) {
    const key = nameKey(record.name);
    if (key.length === 0 || key === self) continue;
    const evidence = evidenceFor(record.name, record.id, query);
    const existing = merged.get(key);
    merged.set(key, {
      name: existing === undefined ? record.name : existing.name,
      evidence: existing === undefined ? [evidence] : [...existing.evidence, evidence],
    });
    if (merged.size >= MAX_CANDIDATES) break;
  }
  return [...merged.values()].map((entry) => ({ name: entry.name, evidence: entry.evidence }));
}

export function serializeStored(row: StoredAdlib): string {
  return JSON.stringify(row);
}

export function parseStoredCandidates(body: string): Candidate[] {
  let raw: unknown;
  try {
    raw = JSON.parse(body) as unknown;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "discovery.meta_adlib_store_unreadable",
        message: error instanceof Error ? error.message : "unreadable",
      }),
    );
    return [];
  }
  const parsed = STORED.safeParse(raw);
  return parsed.success ? parsed.data.candidates : [];
}
