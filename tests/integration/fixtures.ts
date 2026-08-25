import { env } from "cloudflare:workers";

import type { AppEnv } from "~/lib/env.server";

/**
 * The D1 data layer takes `AppEnv`, whose every member is optional. In the
 * `workers` project the binding is the real thing, so the only adaptation
 * needed is the shape.
 */
export const appEnv: AppEnv = { DB: env.DB };

export function db() {
  return env.DB;
}

export const ISO_T0 = "2026-01-01T00:00:00.000Z";

let sequence = 0;
/**
 * Unique-per-call id. The plugin isolates local storage per test FILE, not per
 * test, so rows seeded by one `it()` are still visible to the next one in the
 * same file — every fixture id must be unique within the file, and assertions
 * must scope themselves (by watchlist id, by id prefix) rather than assume an
 * empty table.
 */
export function uid(prefix: string) {
  sequence += 1;
  return `${prefix}_${sequence.toString().padStart(4, "0")}`;
}

export async function seedUser(id = uid("user")) {
  await env.DB.prepare(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, `Fixture ${id}`, `${id}@example.test`, ISO_T0, ISO_T0)
    .run();
  return id;
}

export async function seedWatchlist(userId: string, id = uid("wl")) {
  await env.DB.prepare(
    `INSERT INTO watchlist (
       id, user_id, name, target_type, target_id, target_fingerprint,
       target_label, is_active, created_at, updated_at
     ) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, userId, `Fixture ${id}`, `target_${id}`, `fp_${id}`, `Label ${id}`, ISO_T0, ISO_T0)
    .run();
  return id;
}

export async function seedRun(
  watchlistId: string,
  options: { id?: string; startedAt?: string; status?: string } = {},
) {
  const id = options.id ?? uid("run");
  await env.DB.prepare(
    `INSERT INTO watchlist_run (
       id, watchlist_id, trigger_type, status, summary_json,
       started_at, created_at, updated_at
     ) VALUES (?, ?, 'scheduled', ?, '{}', ?, ?, ?)`,
  )
    .bind(
      id,
      watchlistId,
      options.status ?? "succeeded",
      options.startedAt ?? ISO_T0,
      ISO_T0,
      ISO_T0,
    )
    .run();
  return id;
}

export async function seedAd(id = uid("ad")) {
  await env.DB.prepare(
    `INSERT INTO ad (
       id, advertiser, body, preview_headline, preview_subhead, hook,
       offer_text, cta, creative_format, language_label, destination_type,
       countries_json, platforms_json, source, research_summary, raw_json,
       created_at, updated_at
     ) VALUES (?, 'Fixture Advertiser', 'body', 'headline', 'subhead', 'hook',
       'offer', 'cta', 'image', 'en', 'website', '[]', '[]', 'meta', 'summary',
       '{}', ?, ?)`,
  )
    .bind(id, ISO_T0, ISO_T0)
    .run();
  return id;
}

export async function seedProofTarget(watchlistId: string, id = uid("pt")) {
  await env.DB.prepare(
    `INSERT INTO proof_target (
       id, watchlist_id, canonical_page_identity, proof_target_identity,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, watchlistId, `page_${id}`, `identity_${id}`, ISO_T0, ISO_T0)
    .run();
  return id;
}

/**
 * A proof capture whose `capture_metadata_json` is exactly what the caller
 * passes — the cleanup-claim guard in `createWatchEvent` is a SQL predicate
 * over this column, so the raw string matters.
 */
export async function seedProofCapture(
  proofTargetId: string,
  captureMetadataJson: string,
  id = uid("pc"),
) {
  await env.DB.prepare(
    `INSERT INTO proof_capture (
       id, proof_target_id, status, capture_metadata_json, extractor_version,
       attempted_at, created_at, updated_at
     ) VALUES (?, ?, 'succeeded', ?, 'v1', ?, ?, ?)`,
  )
    .bind(id, proofTargetId, captureMetadataJson, ISO_T0, ISO_T0, ISO_T0)
    .run();
  return id;
}

/** The full seed most watch-event suites need. */
export async function seedWatchlistWithRun() {
  const userId = await seedUser();
  const watchlistId = await seedWatchlist(userId);
  const runId = await seedRun(watchlistId);
  return { userId, watchlistId, runId };
}

export async function countWatchEvents(watchlistId: string) {
  const row = await env.DB.prepare(
    "SELECT count(*) AS n FROM watch_event WHERE watchlist_id = ?",
  )
    .bind(watchlistId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
