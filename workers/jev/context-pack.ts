import {
  normalizeTitle,
  sha256Hex,
  stableStringify,
  type Reliability,
} from "../mentions/map";
import type { MentionItem } from "../sources/mentions/types";

export interface ContextPack {
  self: { name: string | null; domain: string; category: string | null; state: string };
  subject: { name: string | null; domain: string; category: string | null; state: string };
  competitor_set: { name: string | null; domain: string; category: string | null }[];
  item: { title: string; bodyExcerpt: string; source: string; url: string; capturedAt: string };
  history_30d: { kind: string; oneLiner: string; date: string; urlHash: string; titleHash: string | null }[];
  user_memory: { verdict: string; note: string | null }[];
  reliability: Reliability;
  normalizedUrlHash: string;
  normalizedTitleHash: string;
}

export const QUESTION_INSTRUCTIONS = {
  mention_is_about_brand:
    "Is this mention actually about `subject`, not a homonym or a different entity?",
  duplicate_signal:
    "Is `item` the same event as one of `history_30d`, such as syndication, a repost, or a re-crawl?",
  mention_matters:
    "Does this confirmed mention carry signal for `self`, considering reach, sentiment, and source weight?",
} as const;

export type QuestionId = keyof typeof QUESTION_INSTRUCTIONS;

interface CardRow {
  name: string | null;
  domain: string;
  state: string;
  identity_json: string;
  role: string;
}

function categoryOf(identityJson: string): string | null {
  try {
    const parsed = JSON.parse(identityJson) as unknown;
    if (!parsed || typeof parsed !== "object" || !("category" in parsed)) return null;
    return typeof parsed.category === "string" ? parsed.category : null;
  } catch {
    return null;
  }
}

function card(row: CardRow): { name: string | null; domain: string; category: string | null; state: string } {
  return { name: row.name, domain: row.domain, category: categoryOf(row.identity_json), state: row.state };
}

export async function buildContextPack(
  db: D1Database,
  input: {
    workspaceId: string;
    entityId: string;
    item: MentionItem;
    sourceKey: string;
    reliability: Reliability;
    capturedAt: string;
    urlHash: string;
    titleHash: string;
  },
): Promise<ContextPack> {
  const subjectRow = await db
    .prepare("SELECT name, domain, state, identity_json, role FROM entity WHERE id = ?")
    .bind(input.entityId)
    .first<CardRow>();
  const selfRow = await db
    .prepare(
      "SELECT name, domain, state, identity_json, role FROM entity WHERE workspace_id = ? AND role = 'self'",
    )
    .bind(input.workspaceId)
    .first<CardRow>();
  const competitors = await db
    .prepare(
      `SELECT name, domain, state, identity_json, role FROM entity
       WHERE workspace_id = ? AND role = 'competitor' AND state = 'on' AND id != ?`,
    )
    .bind(input.workspaceId, input.entityId)
    .all<CardRow>();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const history = await db
    .prepare(
      `SELECT kind, title, observed_at, url_hash, payload_json FROM signal
       WHERE entity_id = ? AND observed_at >= ? AND is_tombstoned = 0
         AND json_extract(payload_json, '$.collapsed_into') IS NULL
       ORDER BY observed_at DESC LIMIT 30`,
    )
    .bind(input.entityId, since)
    .all<{ kind: string; title: string | null; observed_at: string; url_hash: string | null; payload_json: string }>();
  const memory = await db
    .prepare(
      `SELECT verdict, note FROM user_decision
       WHERE workspace_id = ? AND (entity_id = ? OR entity_id IS NULL)
       ORDER BY decided_at DESC LIMIT 20`,
    )
    .bind(input.workspaceId, input.entityId)
    .all<{ verdict: string; note: string | null }>();
  const subject = subjectRow
    ? card(subjectRow)
    : { name: null, domain: "", category: null, state: "on" };
  const self = selfRow ? card(selfRow) : subject;
  return {
    self,
    subject,
    competitor_set: (competitors.results ?? []).map((row) => {
      const shaped = card(row);
      return { name: shaped.name, domain: shaped.domain, category: shaped.category };
    }),
    item: {
      title: input.item.title,
      bodyExcerpt: input.item.bodyExcerpt,
      source: input.sourceKey,
      url: input.item.canonicalUrl,
      capturedAt: input.capturedAt,
    },
    history_30d: (history.results ?? []).map((row) => {
      let titleHash: string | null = null;
      try {
        const payload = JSON.parse(row.payload_json) as unknown;
        if (payload && typeof payload === "object" && "titleHash" in payload && typeof payload.titleHash === "string") {
          titleHash = payload.titleHash;
        }
      } catch {
        titleHash = null;
      }
      return {
        kind: row.kind,
        oneLiner: row.title ?? "",
        date: row.observed_at,
        urlHash: row.url_hash ?? "",
        titleHash,
      };
    }),
    user_memory: (memory.results ?? []).map((row) => ({ verdict: row.verdict, note: row.note })),
    reliability: input.reliability,
    normalizedUrlHash: input.urlHash,
    normalizedTitleHash: input.titleHash,
  };
}

export async function inputHash(questionId: QuestionId, pack: ContextPack): Promise<string> {
  return sha256Hex(`${questionId}:${stableStringify(pack)}`);
}

export function titleHashFor(title: string): Promise<string> {
  return sha256Hex(normalizeTitle(title));
}
