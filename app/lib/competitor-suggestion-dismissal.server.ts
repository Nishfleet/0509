/**
 * Competitor suggestion dismissals (onboarding epic slice 2, #3175).
 *
 * A suggested competitor is DERIVED on every panel load — `seedAutoCompetitors`
 * re-runs the cached keyword probes and re-ranks. That means a suggestion the
 * customer removed came straight back on the next render. This module is the
 * one durable bit of state that fixes it: a removed suggestion is recorded here
 * and filtered out of every future derivation.
 *
 * The key is the SAME `candidateId` the panel already uses for a row
 * (`buildCandidateId` in `auto-competitor-suggested-loader.server.ts`: the
 * lowercased advertiser, the registrable domain, and the ad-page id joined by
 * `|`). Reusing it is what makes the dismissal survive re-derivation — a
 * different key shape here would silently fail to match and the row would come
 * back, which is the exact bug this closes.
 *
 * Storage contract (migration 0098): a plain table, one row per explicit human
 * removal, never written by a sweep. `INSERT OR IGNORE` against the
 * (user_id, candidate_key) unique index makes a double dismissal a no-op
 * rather than an error or a duplicate.
 */

import type { AppEnv } from "~/lib/env.server";

export interface DismissedSuggestion {
  candidateKey: string;
  candidateDomain: string | null;
}

/**
 * The set of candidate ids this user has removed. The seed reads this once per
 * load and filters before ranking, so a removed suggestion can never be
 * re-ranked back into the panel.
 *
 * A missing table (a deploy that has not yet applied migration 0098) degrades
 * to the empty set rather than throwing — the same posture the suggested loader
 * takes for a downstream failure: never take the page down because the
 * dismissal store is unavailable. An empty set means "nothing dismissed", which
 * is the pre-migration behaviour, so the degrade is safe and honest.
 */
export async function listDismissedSuggestionKeys(
  env: AppEnv,
  userId: string,
): Promise<Set<string>> {
  if (!env.DB || !userId) {
    return new Set();
  }
  let rows: { candidate_key: string; candidate_domain: string | null }[];
  try {
    const result = await env.DB.prepare(
      `SELECT candidate_key, candidate_domain FROM competitor_suggestion_dismissal WHERE user_id = ?`,
    )
      .bind(userId)
      .all<{ candidate_key: string; candidate_domain: string | null }>();
    rows = result.results ?? [];
  } catch (error) {
    // A real read failure would silently RESURRECT every removed suggestion,
    // which is the exact thing this feature guarantees. The empty set is still
    // the only safe degrade (the alternative is taking the page down), but the
    // failure must be observable rather than invisible (#3175 review).
    console.warn(
      JSON.stringify({
        event: "competitor_suggestion_dismissal_read_failed",
        userId,
        error: error instanceof Error ? error.message : String(error),
        ts: new Date().toISOString(),
      }),
    );
    return new Set();
  }
  const keys = new Set<string>();
  for (const row of rows) {
    const key = (row.candidate_key ?? "").trim();
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

/**
 * The set of registrable domains this user has removed. Matched IN ADDITION to
 * the exact candidate key, because the key embeds the ad-page id and the
 * advertiser display name and both can change between sweeps (#3175 review): a
 * candidate stored as `rothy's|rothys.com|` and re-derived as
 * `rothy's|rothys.com|123456` would otherwise silently come back. The domain is
 * the stable identity, which is exactly what `candidate_domain` is for.
 *
 * A dismissal with no resolvable domain contributes nothing here; its exact key
 * still matches above.
 */
export async function listDismissedSuggestionDomains(
  env: AppEnv,
  userId: string,
): Promise<Set<string>> {
  if (!env.DB || !userId) {
    return new Set();
  }
  try {
    const result = await env.DB.prepare(
      `SELECT DISTINCT candidate_domain FROM competitor_suggestion_dismissal
        WHERE user_id = ? AND candidate_domain IS NOT NULL AND candidate_domain != ''`,
    )
      .bind(userId)
      .all<{ candidate_domain: string }>();
    const domains = new Set<string>();
    for (const row of result.results ?? []) {
      const domain = (row.candidate_domain ?? "").trim().toLowerCase();
      if (domain) {
        domains.add(domain);
      }
    }
    return domains;
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "competitor_suggestion_dismissal_domain_read_failed",
        userId,
        error: error instanceof Error ? error.message : String(error),
        ts: new Date().toISOString(),
      }),
    );
    return new Set();
  }
}

/**
 * Record one removal. Idempotent: dismissing the same candidate twice writes
 * one row (the unique index plus `INSERT OR IGNORE`). Returns true when the
 * dismissal is now durable.
 *
 * The label is stored for support/debug only and is never used for matching —
 * matching is the candidate key, plus the domain when a later sweep needs to
 * recognise a candidate whose display name changed.
 */
export async function dismissCompetitorSuggestion(
  env: AppEnv,
  input: {
    userId: string;
    candidateKey: string;
    candidateDomain?: string | null;
    candidateLabel?: string | null;
  },
): Promise<boolean> {
  if (!env.DB) {
    return false;
  }
  const candidateKey = input.candidateKey.trim();
  if (!input.userId || !candidateKey) {
    return false;
  }
  const domain = (input.candidateDomain ?? "").trim().toLowerCase() || null;
  const label = (input.candidateLabel ?? "").trim() || null;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO competitor_suggestion_dismissal
       (id, user_id, candidate_key, candidate_domain, candidate_label, dismissed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      input.userId,
      candidateKey,
      domain,
      label,
      new Date().toISOString(),
    )
    .run();
  return true;
}

/**
 * True when this candidate has already been removed. Used by the accept path to
 * refuse to resurrect a suggestion the customer explicitly rejected, and by
 * tests to assert the removal is durable.
 */
export async function isCompetitorSuggestionDismissed(
  env: AppEnv,
  userId: string,
  candidateKey: string,
): Promise<boolean> {
  if (!env.DB) {
    return false;
  }
  const key = candidateKey.trim();
  if (!userId || !key) {
    return false;
  }
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS present FROM competitor_suggestion_dismissal
        WHERE user_id = ? AND candidate_key = ? LIMIT 1`,
    )
      .bind(userId, key)
      .first<{ present: number }>();
    return row !== null;
  } catch {
    return false;
  }
}
