import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigration } from "./helpers/sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
});

describe("provider-neutral discovery failure migration", () => {
  it("preserves existing evidence and accepts provider_unavailable in both stores", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    applyMigration(db, "migrations/0008_commercial_ad_ingestion_replacement.sql");
    applyMigration(db, "migrations/0009_discovery_query_leases.sql");

    db.prepare(`
      INSERT INTO discovery_fetch_log (
        id, provider, route_context, query_fingerprint, country, status,
        cache_status, failure_class, browser_ms_used, metadata_json, created_at
      ) VALUES (
        'fetch-old', 'meta_library_browser', 'public_search', 'query-old',
        'all', 'failed', 'miss', 'browser_unavailable', NULL, '{}',
        '2026-07-30T00:00:00.000Z'
      )
    `).run();
    db.prepare(`
      INSERT INTO discovery_provider_state (
        provider, status, failure_class, summary, last_success_at,
        last_failure_at, metadata_json, updated_at
      ) VALUES (
        'meta_library_browser', 'degraded', 'browser_unavailable',
        'Browser unavailable.', NULL, '2026-07-30T00:00:00.000Z', '{}',
        '2026-07-30T00:00:00.000Z'
      )
    `).run();

    db.exec("PRAGMA foreign_keys = ON;");
    applyMigration(db, "migrations/0074_provider_neutral_discovery_failures.sql");

    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(
      db.prepare(`
        SELECT failure_class
        FROM discovery_fetch_log
        WHERE id = 'fetch-old'
      `).get(),
    ).toEqual({ failure_class: "browser_unavailable" });
    expect(
      db.prepare(`
        SELECT failure_class
        FROM discovery_provider_state
        WHERE provider = 'meta_library_browser'
      `).get(),
    ).toEqual({ failure_class: "browser_unavailable" });

    db.prepare(`
      INSERT INTO discovery_fetch_log (
        id, provider, route_context, query_fingerprint, country, status,
        cache_status, failure_class, browser_ms_used, metadata_json, created_at
      ) VALUES (
        'fetch-api', 'meta_api', 'public_search', 'query-api', 'all',
        'failed', 'miss', 'provider_unavailable', NULL, '{}',
        '2026-07-30T01:00:00.000Z'
      )
    `).run();
    db.prepare(`
      INSERT INTO discovery_provider_state (
        provider, status, failure_class, summary, last_success_at,
        last_failure_at, metadata_json, updated_at
      ) VALUES (
        'meta_api', 'degraded', 'provider_unavailable',
        'Official Meta API diagnostic fetch failed.', NULL,
        '2026-07-30T01:00:00.000Z', '{}', '2026-07-30T01:00:00.000Z'
      )
    `).run();

    expect(
      db.prepare(`
        SELECT failure_class
        FROM discovery_fetch_log
        WHERE id = 'fetch-api'
      `).get(),
    ).toEqual({ failure_class: "provider_unavailable" });
    expect(
      db.prepare(`
        SELECT failure_class
        FROM discovery_provider_state
        WHERE provider = 'meta_api'
      `).get(),
    ).toEqual({ failure_class: "provider_unavailable" });
    expect(() =>
      db.prepare(`
        UPDATE discovery_fetch_log
        SET failure_class = 'not_a_failure_class'
        WHERE id = 'fetch-api'
      `).run(),
    ).toThrow();
    expect(() =>
      db.prepare(`
        UPDATE discovery_provider_state
        SET failure_class = 'not_a_failure_class'
        WHERE provider = 'meta_api'
      `).run(),
    ).toThrow();

    const indexNames = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => String(row.name));
    expect(indexNames).toEqual(
      expect.arrayContaining([
        "idx_discovery_fetch_log_provider_created",
        "idx_discovery_fetch_log_route_status_created",
        "idx_discovery_fetch_log_status_created",
      ]),
    );
  });
});
