import { jevAsk, type JevClientEnv } from "../jev/client";
import { homepageLive, type Resolution } from "./resolve-domain";
import type { ScoredCandidate } from "./shortlist";
import { normaliseName } from "./types";

export const D1_QUESTION = "d1.is_competitor";
export const D2_QUESTION = "d2.still_competitor";

const ACCEPT_P = 0.9;
const DROP_P = 0.1;
const D2_RETIRE_REASONS = new Set(["acquired", "shut down"]);

export interface JudgeEnv extends JevClientEnv {
  DB: D1Database;
  fetchImpl?: typeof fetch;
}

export type Decision = "accept" | "maybe" | "drop";

export interface JudgedCandidate {
  scored: ScoredCandidate;
  domain: string | null;
  live: boolean;
  decision: Decision;
  p: number | null;
  verdictReason: string | null;
  inputHash: string;
  judged: boolean;
}

export type D2Outcome =
  | { entityId: string; domain: string; action: "keep"; p: number | null; inputHash: string }
  | { entityId: string; domain: string; action: "retire"; reason: string; p: number | null; inputHash: string }
  | { entityId: string; domain: string; action: "ask"; reason: string | null; p: number | null; inputHash: string }
  | { entityId: string; domain: string; action: "unjudged"; p: null; inputHash: string };

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function inputHash(questionId: string, pack: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableStringify({ q: questionId, pack })),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface SelfCard {
  name: string | null;
  domain: string;
  category: string | null;
  country: string | null;
}

interface PackBase {
  self: SelfCard | null;
  competitor_set: { name: string | null; domain: string }[];
  user_memory: { dismissed_domains: string[]; turned_off_domains: string[] };
}

async function basePack(env: JudgeEnv, workspaceId: string): Promise<PackBase> {
  const self = await env.DB.prepare(
    "SELECT domain, name, identity_json FROM entity WHERE workspace_id = ? AND role = 'self'",
  )
    .bind(workspaceId)
    .first<{ domain: string; name: string | null; identity_json: string }>();
  let selfCard: SelfCard | null = null;
  if (self) {
    let identity: { category?: string; country?: string } = {};
    try {
      identity = JSON.parse(self.identity_json) as typeof identity;
    } catch {
      identity = {};
    }
    selfCard = {
      name: self.name,
      domain: self.domain,
      category: identity.category ?? null,
      country: identity.country ?? null,
    };
  }
  const competitors = await env.DB.prepare(
    "SELECT name, domain FROM entity WHERE workspace_id = ? AND role = 'competitor' AND state != 'dismissed'",
  )
    .bind(workspaceId)
    .all<{ name: string | null; domain: string }>();
  const dismissed = await env.DB.prepare(
    "SELECT candidate_domain FROM suggestion WHERE workspace_id = ? AND status = 'dismissed'",
  )
    .bind(workspaceId)
    .all<{ candidate_domain: string }>();
  const turnedOff = await env.DB.prepare(
    "SELECT domain FROM entity WHERE workspace_id = ? AND state = 'off'",
  )
    .bind(workspaceId)
    .all<{ domain: string }>();
  return {
    self: selfCard,
    competitor_set: competitors.results,
    user_memory: {
      dismissed_domains: dismissed.results.map((r) => r.candidate_domain),
      turned_off_domains: turnedOff.results.map((r) => r.domain),
    },
  };
}

async function reliabilityMap(env: JudgeEnv): Promise<Map<string, string>> {
  const rows = await env.DB.prepare("SELECT plugin_key, reliability FROM source").all<{
    plugin_key: string;
    reliability: string;
  }>();
  return new Map(rows.results.map((r) => [r.plugin_key, r.reliability]));
}

export async function excludedDomains(
  env: JudgeEnv,
  workspaceId: string,
): Promise<Set<string>> {
  const excluded = new Set<string>();
  const entities = await env.DB.prepare(
    "SELECT domain FROM entity WHERE workspace_id = ? AND role = 'competitor'",
  )
    .bind(workspaceId)
    .all<{ domain: string }>();
  for (const row of entities.results) excluded.add(row.domain);
  const dismissed = await env.DB.prepare(
    "SELECT candidate_domain FROM suggestion WHERE workspace_id = ? AND status = 'dismissed'",
  )
    .bind(workspaceId)
    .all<{ candidate_domain: string }>();
  for (const row of dismissed.results) excluded.add(row.candidate_domain);
  const takedowns = await env.DB.prepare(
    "SELECT DISTINCT domain FROM entity WHERE state = 'dismissed' AND state_reason = 'takedown'",
  ).all<{ domain: string }>();
  for (const row of takedowns.results) excluded.add(row.domain);
  return excluded;
}

export async function judgeShortlist(
  env: JudgeEnv,
  workspaceId: string,
  rows: ScoredCandidate[],
  resolutions: Map<string, Resolution>,
): Promise<JudgedCandidate[]> {
  const fetchImpl = env.fetchImpl ?? fetch;
  const [packBase, reliability, excluded] = await Promise.all([
    basePack(env, workspaceId),
    reliabilityMap(env),
    excludedDomains(env, workspaceId),
  ]);
  const judged: JudgedCandidate[] = [];
  for (const row of rows) {
    if (!row.shortlisted) continue;
    const resolution = resolutions.get(row.key) ?? null;
    const domain = row.domain ?? resolution?.domain ?? null;
    const candidateKey = domain ?? `name:${normaliseName(row.candidate.name)}`;
    if (excluded.has(candidateKey)) continue;
    const live = domain
      ? resolution !== null
        ? resolution.live
        : await homepageLive(domain, fetchImpl)
      : false;
    const item = {
      name: row.candidate.name,
      domain,
      evidence: row.candidate.evidence.map((e) => ({
        source_url: e.sourceUrl,
        excerpt: e.excerpt,
        generator: e.generator,
      })),
    };
    const pack = {
      ...packBase,
      subject: { name: row.candidate.name, domain },
      item,
      reliability: Object.fromEntries(
        [...new Set(row.candidate.evidence.map((e) => e.generator))].map((g) => [
          g,
          reliability.get(g) ?? "best_effort",
        ]),
      ),
    };
    const hash = await inputHash(D1_QUESTION, pack);
    const cached = await env.DB.prepare(
      "SELECT p, reason FROM jev_verdict WHERE question_id = ? AND input_hash = ?",
    )
      .bind(D1_QUESTION, hash)
      .first<{ p: number | null; reason: string | null }>();
    let p: number | null;
    let reason: string | null;
    let wasJudged: boolean;
    if (cached) {
      p = cached.p;
      reason = cached.reason;
      wasJudged = true;
    } else {
      const answers = await jevAsk(
        env,
        pack,
        {
          is_competitor: {
            type: "boolean",
            instructions:
              "Is the candidate a real competitor of self — same market, same offer, fighting for the same buyer?",
          },
        },
        fetchImpl,
      );
      p = answers?.is_competitor?.probability ?? null;
      reason = answers?.is_competitor?.reason ?? null;
      wasJudged = p !== null;
    }
    let decision: Decision;
    if (p === null) decision = "maybe";
    else if (p >= ACCEPT_P)
      decision = domain !== null && live && row.candidate.evidence.length > 0 ? "accept" : "maybe";
    else if (p <= DROP_P) decision = "drop";
    else decision = "maybe";
    judged.push({
      scored: row,
      domain,
      live,
      decision,
      p,
      verdictReason: reason,
      inputHash: hash,
      judged: wasJudged,
    });
  }
  return judged;
}

export async function judgeTracked(
  env: JudgeEnv,
  workspaceId: string,
): Promise<D2Outcome[]> {
  const fetchImpl = env.fetchImpl ?? fetch;
  const tracked = await env.DB.prepare(
    "SELECT id, domain, name, origin FROM entity WHERE workspace_id = ? AND role = 'competitor' AND state = 'on'",
  )
    .bind(workspaceId)
    .all<{ id: string; domain: string; name: string | null; origin: string }>();
  if (tracked.results.length === 0) return [];
  const packBase = await basePack(env, workspaceId);
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const outcomes: D2Outcome[] = [];
  for (const entity of tracked.results) {
    const history = await env.DB.prepare(
      "SELECT kind, title, observed_at FROM signal WHERE entity_id = ? AND observed_at > ? ORDER BY observed_at DESC LIMIT 30",
    )
      .bind(entity.id, cutoff)
      .all<{ kind: string; title: string | null; observed_at: string }>();
    const pack = {
      ...packBase,
      subject: {
        name: entity.name,
        domain: entity.domain,
        tracking: { state: "on", user_added: entity.origin === "manual" },
      },
      history_30d: history.results,
    };
    const hash = await inputHash(D2_QUESTION, pack);
    const cached = await env.DB.prepare(
      "SELECT p, choice, reason FROM jev_verdict WHERE question_id = ? AND input_hash = ?",
    )
      .bind(D2_QUESTION, hash)
      .first<{ p: number | null; choice: string | null; reason: string | null }>();
    let p = cached?.p ?? null;
    let choice = cached?.choice ?? null;
    if (!cached) {
      const answers = await jevAsk(
        env,
        pack,
        {
          still_competitor: {
            type: "boolean",
            instructions: "Given the last 30 days, is the subject still a live competitor of self?",
          },
          reason: {
            type: "choice",
            instructions: "What best describes the subject's current state?",
            criteria: {
              active: "Trading and competing as before",
              acquired: "Bought by or merged into another company",
              "shut down": "Closed, domain dead or redirecting away",
              pivoted: "Still trading but no longer in this market",
              dormant: "No visible activity but not confirmed closed",
            },
          },
        },
        fetchImpl,
      );
      p = answers?.still_competitor?.probability ?? null;
      choice = answers?.reason?.choice ?? null;
    }
    const base = { entityId: entity.id, domain: entity.domain, p, inputHash: hash };
    if (p === null) {
      outcomes.push({ ...base, p: null, action: "unjudged" });
    } else if (
      p <= DROP_P &&
      choice !== null &&
      D2_RETIRE_REASONS.has(choice) &&
      entity.origin !== "manual"
    ) {
      outcomes.push({ ...base, action: "retire", reason: choice });
    } else if (p >= ACCEPT_P && (choice === null || choice === "active")) {
      outcomes.push({ ...base, action: "keep" });
    } else {
      outcomes.push({ ...base, action: "ask", reason: choice });
    }
  }
  return outcomes;
}
