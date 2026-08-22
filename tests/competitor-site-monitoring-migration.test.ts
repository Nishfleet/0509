import { readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

type SqliteBindings = Parameters<ReturnType<DatabaseSync["prepare"]>["run"]>;

const databases: DatabaseSync[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
});

const LEGACY_EVENT_TYPES = [
  "ad_new",
  "ad_inactive",
  "landing_page_url_changed",
  "landing_page_headline_changed",
  "landing_page_offer_changed",
  "landing_page_cta_changed",
  "landing_page_form_changed",
] as const;

const WEBSITE_EVENT_TYPES = [
  "website_page_added",
  "website_page_removed",
  "website_page_changed",
] as const;

const SCAN_COLUMNS = [
  "id",
  "workspace_id",
  "watchlist_id",
  "watchlist_run_id",
  "root_url",
  "status",
  "inventory_complete",
  "discovered_page_count",
  "sitemap_document_count",
  "fetched_page_count",
  "page_budget",
  "scan_cursor",
  "inventory_hash",
  "failure_code",
  "processing_token",
  "started_at",
  "finalized_at",
  "created_at",
  "updated_at",
] as const;

const SCAN_PAGE_COLUMNS = [
  "id",
  "site_scan_id",
  "canonical_url",
  "discovery_source",
  "page_kind",
  "stable_order",
  "created_at",
  "updated_at",
] as const;

const OBSERVATION_COLUMNS = [
  "id",
  "workspace_id",
  "watchlist_id",
  "watchlist_run_id",
  "canonical_url",
  "discovery_source",
  "page_kind",
  "content_hash",
  "excerpt",
  "proof_capture_id",
  "fetch_status",
  "http_status",
  "fetch_error_code",
  "normalizer_version",
  "signals_json",
  "observed_at",
  "created_at",
  "updated_at",
] as const;

const PAGE_KINDS = [
  "home",
  "pricing",
  "changelog",
  "landing",
  "product",
  "blog",
  "docs",
  "about",
  "contact",
  "other",
] as const;

const DISCOVERY_SOURCES = [
  "watchlist_seed",
  "robots_declared_sitemap",
  "conventional_sitemap",
  "sitemap_content",
] as const;

/**
 * A database with the pre-0075 schema (through 0022) plus a full set of
 * legacy watch_event and event_candidate rows, one per prior event type.
 */
function buildDbWithLegacyEvents() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  applyMigration(db, "migrations/0000_auth.sql");
  applyMigration(db, "migrations/0001_app.sql");
  applyMigration(db, "migrations/0007_proof_first_change_alerts.sql");
  applyMigration(db, "migrations/0008_commercial_ad_ingestion_replacement.sql");
  applyMigration(db, "migrations/0009_discovery_query_leases.sql");
  applyMigration(db, "migrations/0022_hot_path_indexes.sql");
  // 0047 adds the run-level processing_token lease columns used by the scan
  // lifecycle; it is part of the durable pre-0075 schema in production.
  applyMigration(db, "migrations/0047_monitoring_fanout_orchestration.sql");
  db.exec("PRAGMA foreign_keys = ON;");

  db.prepare(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run("user-1", "Owner", "owner@example.com", "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO watchlist (
       id, user_id, name, target_type, target_id, target_fingerprint,
       target_label, is_active, created_at, updated_at
     ) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
  ).run(
    "watch-1",
    "user-1",
    "Competitor site",
    "site",
    "fp-site",
    "competitor.example",
    "2026-08-01T00:00:00.000Z",
    "2026-08-01T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO watchlist_run (
       id, watchlist_id, trigger_type, status, page_budget, pages_scanned,
       summary_json, started_at, created_at, updated_at
     ) VALUES (?, ?, 'scheduled', 'succeeded', 3, 3, '{}', ?, ?, ?)`,
  ).run(
    "run-1",
    "watch-1",
    "2026-08-01T01:00:00.000Z",
    "2026-08-01T01:00:00.000Z",
    "2026-08-01T01:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO ad (
       id, advertiser, body, preview_headline, preview_subhead, hook,
       offer_text, cta, creative_format, language_label, destination_type,
       countries_json, platforms_json, is_active, source, research_summary,
       raw_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
  ).run(
    "ad-1",
    "Competitor",
    "body",
    "headline",
    "subhead",
    "hook",
    "offer",
    "Shop",
    "image",
    "English",
    "website",
    '["all"]',
    "[]",
    "meta_library_browser",
    "research",
    "{}",
    "2026-08-01T00:00:00.000Z",
    "2026-08-01T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO proof_target (
       id, watchlist_id, canonical_page_identity, proof_target_identity,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "pt-1",
    "watch-1",
    "https://competitor.example/",
    "proof-identity-1",
    "2026-08-01T00:00:00.000Z",
    "2026-08-01T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO proof_capture (
       id, proof_target_id, status, extractor_version, attempted_at,
       created_at, updated_at
     ) VALUES (?, ?, 'succeeded', 'test-1', ?, ?, ?)`,
  ).run(
    "pc-1",
    "pt-1",
    "2026-08-01T01:00:00.000Z",
    "2026-08-01T01:00:00.000Z",
    "2026-08-01T01:00:00.000Z",
  );

  LEGACY_EVENT_TYPES.forEach((eventType, index) => {
    db.prepare(
      `INSERT INTO watch_event (
         id, watchlist_id, run_id, event_type, status, importance_score,
         ad_id, title, summary, metadata_json, confirmed_at,
         last_evaluated_at, created_at
       ) VALUES (?, ?, ?, ?, 'confirmed', 50, ?, ?, ?, '{}', ?, ?, ?)`,
    ).run(
      `we-${index}`,
      "watch-1",
      "run-1",
      eventType,
      index === 0 ? "ad-1" : null,
      `Title ${index}`,
      `Summary ${index}`,
      "2026-08-01T01:00:00.000Z",
      "2026-08-01T01:00:00.000Z",
      "2026-08-01T01:00:00.000Z",
    );
    db.prepare(
      `INSERT INTO event_candidate (
         id, watchlist_id, run_id, event_type, status, importance_score,
         ad_id, title, summary, metadata_json, proof_required, detected_at,
         last_evaluated_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'detected', 40, ?, ?, ?, '{}', 0, ?, ?, ?, ?)`,
    ).run(
      `ec-${index}`,
      "watch-1",
      "run-1",
      eventType,
      index === 0 ? "ad-1" : null,
      `Candidate ${index}`,
      `Candidate summary ${index}`,
      "2026-08-01T01:00:00.000Z",
      "2026-08-01T01:00:00.000Z",
      "2026-08-01T01:00:00.000Z",
      "2026-08-01T01:00:00.000Z",
    );
  });

  return db;
}

function insertWatchEvent(
  db: DatabaseSync,
  id: string,
  eventType: string,
) {
  db.prepare(
    `INSERT INTO watch_event (
       id, watchlist_id, run_id, event_type, status, importance_score,
       title, summary, metadata_json, confirmed_at, last_evaluated_at,
       created_at
     ) VALUES (?, ?, ?, ?, 'confirmed', 60, 't', 's', '{}', ?, ?, ?)`,
  ).run(id, "watch-1", "run-1", eventType, "2026-08-01T02:00:00.000Z", "2026-08-01T02:00:00.000Z", "2026-08-01T02:00:00.000Z");
}

function insertEventCandidate(
  db: DatabaseSync,
  id: string,
  eventType: string,
) {
  db.prepare(
    `INSERT INTO event_candidate (
       id, watchlist_id, run_id, event_type, status, importance_score,
       title, summary, metadata_json, proof_required, detected_at,
       last_evaluated_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'detected', 30, 't', 's', '{}', 0, ?, ?, ?, ?)`,
  ).run(id, "watch-1", "run-1", eventType, "2026-08-01T02:00:00.000Z", "2026-08-01T02:00:00.000Z", "2026-08-01T02:00:00.000Z", "2026-08-01T02:00:00.000Z");
}

/** A running run that can own a scan. */
function insertRunningRun(db: DatabaseSync, runId: string, startedAt: string) {
  db.prepare(
    `INSERT INTO watchlist_run (
       id, watchlist_id, trigger_type, status, page_budget, pages_scanned,
       summary_json, started_at, processing_token, created_at, updated_at
     ) VALUES (?, ?, 'manual', 'running', 50, 0, '{}', ?, 'tok-1', ?, ?)`,
  ).run(runId, "watch-1", startedAt, startedAt, startedAt);
}

/** A populated pre-0075 chain plus a running run that can own a scan. */
function buildDbForScanLifecycle() {
  const db = buildDbWithLegacyEvents();
  insertRunningRun(db, "run-scan", "2026-08-02T01:00:00.000Z");
  return db;
}

/** A valid running manifest for a running run. */
function insertRunningScan(db: DatabaseSync, id = "scan-1", runId = "run-scan") {
  db.prepare(
    `INSERT INTO website_site_scan (
       id, workspace_id, watchlist_id, watchlist_run_id, root_url, status,
       inventory_complete, discovered_page_count, sitemap_document_count,
       fetched_page_count, page_budget, scan_cursor, inventory_hash,
       failure_code, processing_token, started_at, finalized_at, created_at,
       updated_at
     ) VALUES (?, 'user-1', 'watch-1', ?, ?, 'running', 0, 0, 0, 0,
       50, NULL, NULL, NULL, 'tok-1', ?, NULL, ?, ?)`,
  ).run(
    id,
    runId,
    "https://competitor.example/",
    "2026-08-02T01:00:00.000Z",
    "2026-08-02T01:00:00.000Z",
    "2026-08-02T01:00:00.000Z",
  );
}

function insertObservation(
  db: DatabaseSync,
  overrides: Record<string, unknown> = {},
) {
  const values: Record<string, unknown> = {
    id: "obs-1",
    workspace_id: "user-1",
    watchlist_id: "watch-1",
    watchlist_run_id: "run-scan",
    canonical_url: "https://competitor.example/",
    discovery_source: "watchlist_seed",
    page_kind: "home",
    content_hash: "hash-1",
    excerpt: null,
    proof_capture_id: null,
    fetch_status: "fetched",
    http_status: 200,
    fetch_error_code: null,
    normalizer_version: "normalizer-v1",
    signals_json: '{"title":"Home","metaDescription":null,"visibleTextHash":"vt-1","visibleTextExcerpt":"x","offer":null,"price":null,"cta":"Buy","formPresent":false}',
    observed_at: "2026-08-02T02:00:00.000Z",
    created_at: "2026-08-02T02:00:00.000Z",
    updated_at: "2026-08-02T02:00:00.000Z",
  };
  Object.assign(values, overrides);
  db.prepare(
    `INSERT INTO website_page_observation (
       id, workspace_id, watchlist_id, watchlist_run_id, canonical_url,
       discovery_source, page_kind, content_hash, excerpt, proof_capture_id,
       fetch_status, http_status, fetch_error_code, normalizer_version,
       signals_json, observed_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(...(OBSERVATION_COLUMNS.map((column) => values[column]) as SqliteBindings));
}

describe("competitor-site monitoring migration", () => {
  it("preserves every prior event type and row in watch_event and event_candidate while extending both vocabularies", () => {
    const db = buildDbWithLegacyEvents();
    applyMigration(db, "migrations/0075_competitor_site_monitoring.sql");

    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    // The populated chain must stay referentially clean through the rebuild.
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    // Every legacy row survived the rebuild with identical values.
    LEGACY_EVENT_TYPES.forEach((eventType, index) => {
      const event = db
        .prepare(
          `SELECT id, event_type, title, summary
           FROM watch_event WHERE id = ?`,
        )
        .get(`we-${index}`);
      expect(event).toEqual({
        id: `we-${index}`,
        event_type: eventType,
        title: `Title ${index}`,
        summary: `Summary ${index}`,
      });
      const candidate = db
        .prepare(
          `SELECT id, event_type, title, summary
           FROM event_candidate WHERE id = ?`,
        )
        .get(`ec-${index}`);
      expect(candidate).toEqual({
        id: `ec-${index}`,
        event_type: eventType,
        title: `Candidate ${index}`,
        summary: `Candidate summary ${index}`,
      });
    });
    expect(
      db.prepare("SELECT COUNT(*) AS total FROM watch_event").get(),
    ).toEqual({ total: LEGACY_EVENT_TYPES.length });
    expect(
      db.prepare("SELECT COUNT(*) AS total FROM event_candidate").get(),
    ).toEqual({ total: LEGACY_EVENT_TYPES.length });

    // Every legacy type remains insertable.
    LEGACY_EVENT_TYPES.forEach((eventType, index) => {
      insertWatchEvent(db, `we-new-${index}`, eventType);
      insertEventCandidate(db, `ec-new-${index}`, eventType);
    });

    // The new website vocabulary is accepted in both stores…
    WEBSITE_EVENT_TYPES.forEach((eventType, index) => {
      insertWatchEvent(db, `we-site-${index}`, eventType);
      insertEventCandidate(db, `ec-site-${index}`, eventType);
    });
    expect(
      db
        .prepare(
          "SELECT event_type FROM watch_event WHERE id = 'we-site-0'",
        )
        .get(),
    ).toEqual({ event_type: "website_page_added" });

    // …and unknown values stay rejected.
    expect(() => insertWatchEvent(db, "we-bad", "website_page_renamed")).toThrow();
    expect(() => insertEventCandidate(db, "ec-bad", "not_an_event")).toThrow();

    // Rebuilt-table indexes are back in place.
    const indexNames = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => String(row.name));
    expect(indexNames).toEqual(
      expect.arrayContaining([
        "idx_watch_event_watchlist_created",
        "idx_watch_event_watchlist_status_created",
        "idx_watch_event_run",
        "idx_watch_event_baseline_run",
        "idx_event_candidate_watchlist_status_detected",
        "idx_event_candidate_run",
      ]),
    );
  });

  it("creates website_site_scan with the manifest shape, per-run uniqueness, bounds, invariants, and foreign keys", () => {
    const db = buildDbForScanLifecycle();
    applyMigration(db, "migrations/0075_competitor_site_monitoring.sql");

    const columns = db
      .prepare("PRAGMA table_info(website_site_scan)")
      .all()
      .map((row) => String(row.name));
    expect(columns).toEqual(expect.arrayContaining([...SCAN_COLUMNS]));

    const insert = db.prepare(
      `INSERT INTO website_site_scan (
         id, workspace_id, watchlist_id, watchlist_run_id, root_url, status,
         inventory_complete, discovered_page_count, sitemap_document_count,
         fetched_page_count, page_budget, scan_cursor, inventory_hash,
         failure_code, processing_token, started_at, finalized_at, created_at,
         updated_at
       ) VALUES (?, 'user-1', 'watch-1', ?, ?, ?, 0, 0, 0, 0, ?, NULL, NULL,
         NULL, 'tok-1', ?, NULL, ?, ?)`,
    );

    insert.run(
      "scan-1",
      "run-scan",
      "https://competitor.example/",
      "running",
      50,
      "2026-08-02T01:00:00.000Z",
      "2026-08-02T01:00:00.000Z",
      "2026-08-02T01:00:00.000Z",
    );

    // Exactly one manifest per watchlist_run.
    expect(() =>
      insert.run(
        "scan-1-dup",
        "run-scan",
        "https://competitor.example/",
        "running",
        50,
        "2026-08-02T01:00:00.000Z",
        "2026-08-02T01:00:00.000Z",
        "2026-08-02T01:00:00.000Z",
      ),
    ).toThrow();

    const reject = (
      overrides: Partial<Record<string, unknown>>,
      label: string,
    ) => {
      const values: Record<string, unknown> = {
        id: "scan-reject",
        watchlist_run_id: "run-scan",
        root_url: "https://competitor.example/",
        status: "running",
        page_budget: 50,
        started_at: "2026-08-02T01:00:00.000Z",
        created_at: "2026-08-02T01:00:00.000Z",
        updated_at: "2026-08-02T01:00:00.000Z",
      };
      Object.assign(values, overrides);
      const bound = [
        values.id,
        values.watchlist_run_id,
        values.root_url,
        values.status,
        values.page_budget,
        values.started_at,
        values.created_at,
        values.updated_at,
      ] as SqliteBindings;
      expect(
        () => insert.run(...bound),
        label,
      ).toThrow();
    };

    reject({ status: "paused" }, "unknown lifecycle status");
    reject({ page_budget: 0 }, "page budget below bound");
    reject({ page_budget: 5001 }, "page budget above bound");
    reject({ scan_cursor: "c".repeat(513) }, "over-long cursor");
    reject({ inventory_hash: "h".repeat(129) }, "over-long inventory hash");
    reject({ failure_code: "f".repeat(65) }, "over-long failure code");
    reject({ root_url: "https://competitor.example/" + "x".repeat(2030) }, "over-long root URL");

    // Running manifests cannot be finalized already, and non-running
    // manifests must be finalized.
    reject(
      { id: "scan-f", status: "running", finalized_at: "2026-08-02T03:00:00.000Z" },
      "running with finalized_at",
    );
    reject(
      { id: "scan-f", status: "complete", finalized_at: null },
      "complete without finalized_at",
    );

    // Complete requires inventory_complete; partial/failed forbid it.
    reject(
      { id: "scan-f", status: "complete", inventory_complete: 0 },
      "complete without inventory",
    );
    reject(
      { id: "scan-f", status: "partial", inventory_complete: 1 },
      "partial with inventory",
    );

    // Failed requires a failure code; non-failed forbids one.
    reject({ id: "scan-f", status: "failed", failure_code: null }, "failed without code");
    reject({ id: "scan-f", status: "complete", failure_code: "boom" }, "complete with code");

    // Foreign keys: unknown owner, watchlist, or run are rejected.
    expect(() =>
      db.prepare(
        `INSERT INTO website_site_scan (
           id, workspace_id, watchlist_id, watchlist_run_id, root_url, status,
           inventory_complete, discovered_page_count, sitemap_document_count,
           fetched_page_count, page_budget, scan_cursor, inventory_hash,
           failure_code, processing_token, started_at, finalized_at, created_at,
           updated_at
         ) VALUES (?, 'missing-user', 'watch-1', 'run-scan', 'https://x/', 'running',
           0, 0, 0, 0, 50, NULL, NULL, NULL, 'tok-1', ?, NULL, ?, ?)`,
      ).run("scan-bad-ws", "2026-08-02T01:00:00.000Z", "2026-08-02T01:00:00.000Z", "2026-08-02T01:00:00.000Z"),
    ).toThrow();
    expect(() =>
      db.prepare(
        `INSERT INTO website_site_scan (
           id, workspace_id, watchlist_id, watchlist_run_id, root_url, status,
           inventory_complete, discovered_page_count, sitemap_document_count,
           fetched_page_count, page_budget, scan_cursor, inventory_hash,
           failure_code, processing_token, started_at, finalized_at, created_at,
           updated_at
         ) VALUES (?, 'user-1', 'missing-watch', 'run-scan', 'https://x/', 'running',
           0, 0, 0, 0, 50, NULL, NULL, NULL, 'tok-1', ?, NULL, ?, ?)`,
      ).run("scan-bad-watch", "2026-08-02T01:00:00.000Z", "2026-08-02T01:00:00.000Z", "2026-08-02T01:00:00.000Z"),
    ).toThrow();
    expect(() =>
      db.prepare(
        `INSERT INTO website_site_scan (
           id, workspace_id, watchlist_id, watchlist_run_id, root_url, status,
           inventory_complete, discovered_page_count, sitemap_document_count,
           fetched_page_count, page_budget, scan_cursor, inventory_hash,
           failure_code, processing_token, started_at, finalized_at, created_at,
           updated_at
         ) VALUES (?, 'user-1', 'watch-1', 'missing-run', 'https://x/', 'running',
           0, 0, 0, 0, 50, NULL, NULL, NULL, 'tok-1', ?, NULL, ?, ?)`,
      ).run("scan-bad-run", "2026-08-02T01:00:00.000Z", "2026-08-02T01:00:00.000Z", "2026-08-02T01:00:00.000Z"),
    ).toThrow();

    // A finalized complete manifest is representable.
    db.prepare(
      `UPDATE website_site_scan
       SET status = 'complete',
           inventory_complete = 1,
           discovered_page_count = 2,
           fetched_page_count = 1,
           scan_cursor = 'cursor-1',
           inventory_hash = 'inventory-hash-1',
           finalized_at = ?,
           updated_at = ?
       WHERE id = 'scan-1'`,
    ).run("2026-08-02T03:00:00.000Z", "2026-08-02T03:00:00.000Z");
    expect(
      db
        .prepare(
          `SELECT status, inventory_complete, discovered_page_count, scan_cursor
           FROM website_site_scan WHERE id = 'scan-1'`,
        )
        .get(),
    ).toEqual({
      status: "complete",
      inventory_complete: 1,
      discovered_page_count: 2,
      scan_cursor: "cursor-1",
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("creates website_site_scan_page with the exact vocabularies, per-scan URL uniqueness, stable order, and cascade", () => {
    const db = buildDbForScanLifecycle();
    applyMigration(db, "migrations/0075_competitor_site_monitoring.sql");
    insertRunningScan(db, "scan-1");

    const columns = db
      .prepare("PRAGMA table_info(website_site_scan_page)")
      .all()
      .map((row) => String(row.name));
    expect(columns).toEqual(expect.arrayContaining([...SCAN_PAGE_COLUMNS]));

    const insert = db.prepare(
      `INSERT INTO website_site_scan_page (
         id, site_scan_id, canonical_url, discovery_source, page_kind,
         stable_order, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    // Every exact page kind and discovery source is accepted.
    PAGE_KINDS.forEach((pageKind, index) => {
      insert.run(
        `page-${index}`,
        "scan-1",
        `https://competitor.example/kind-${index}`,
        "watchlist_seed",
        pageKind,
        index,
        "2026-08-02T02:00:00.000Z",
        "2026-08-02T02:00:00.000Z",
      );
    });
    DISCOVERY_SOURCES.forEach((source, index) => {
      insert.run(
        `page-source-${index}`,
        "scan-1",
        `https://competitor.example/source-${index}`,
        source,
        "other",
        index + PAGE_KINDS.length,
        "2026-08-02T02:00:00.000Z",
        "2026-08-02T02:00:00.000Z",
      );
    });

    // Unknown vocabularies and out-of-bound order are rejected.
    expect(() =>
      insert.run("page-bad-kind", "scan-1", "https://competitor.example/bad-kind", "sitemap_content", "newsletter", 100, "2026-08-02T02:00:00.000Z", "2026-08-02T02:00:00.000Z"),
    ).toThrow();
    expect(() =>
      insert.run("page-bad-source", "scan-1", "https://competitor.example/bad-source", "dns_scan", "other", 101, "2026-08-02T02:00:00.000Z", "2026-08-02T02:00:00.000Z"),
    ).toThrow();
    expect(() =>
      insert.run("page-bad-order", "scan-1", "https://competitor.example/bad-order", "sitemap_content", "other", -1, "2026-08-02T02:00:00.000Z", "2026-08-02T02:00:00.000Z"),
    ).toThrow();
    expect(() =>
      insert.run("page-bad-url", "scan-1", "https://competitor.example/" + "x".repeat(2040), "sitemap_content", "other", 102, "2026-08-02T02:00:00.000Z", "2026-08-02T02:00:00.000Z"),
    ).toThrow();
    expect(() =>
      insert.run("page-bad-scan", "missing-scan", "https://competitor.example/orphan", "sitemap_content", "other", 103, "2026-08-02T02:00:00.000Z", "2026-08-02T02:00:00.000Z"),
    ).toThrow();

    // One canonical inventory row per scan + URL.
    expect(() =>
      insert.run("page-dup", "scan-1", "https://competitor.example/kind-0", "sitemap_content", "home", 200, "2026-08-02T02:00:00.000Z", "2026-08-02T02:00:00.000Z"),
    ).toThrow();

    // The same URL is its own row in a second scan.
    insertRunningRun(db, "run-scan-2", "2026-08-02T03:00:00.000Z");
    insertRunningScan(db, "scan-2", "run-scan-2");
    insert.run("page-scan2", "scan-2", "https://competitor.example/kind-0", "sitemap_content", "home", 0, "2026-08-02T03:00:00.000Z", "2026-08-02T03:00:00.000Z");

    // Deleting the scan cascades to its inventory.
    db.prepare("DELETE FROM website_site_scan WHERE id = 'scan-2'").run();
    expect(
      db.prepare("SELECT COUNT(*) AS total FROM website_site_scan_page WHERE site_scan_id = 'scan-2'").get(),
    ).toEqual({ total: 0 });

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("creates website_page_observation with nullable failed-fetch content, bounded signals, and run/URL uniqueness", () => {
    const db = buildDbForScanLifecycle();
    applyMigration(db, "migrations/0075_competitor_site_monitoring.sql");
    insertRunningScan(db, "scan-1");

    const columns = db
      .prepare("PRAGMA table_info(website_page_observation)")
      .all()
      .map((row) => String(row.name));
    expect(columns).toEqual(expect.arrayContaining([...OBSERVATION_COLUMNS]));

    // A fetched observation requires the content hash (schema-enforced)…
    expect(() =>
      insertObservation(db, { id: "obs-nohash", content_hash: null }),
    ).toThrow();

    // …while failed/skipped fetches may carry no content or signals.
    insertObservation(db, {
      id: "obs-failed",
      fetch_status: "fetch_failed",
      http_status: null,
      fetch_error_code: "network_error",
      content_hash: null,
      normalizer_version: null,
      signals_json: null,
      excerpt: null,
    });
    insertObservation(db, {
      id: "obs-skipped",
      canonical_url: "https://competitor.example/skipped",
      fetch_status: "skipped",
      http_status: null,
      fetch_error_code: "budget",
      content_hash: null,
      normalizer_version: null,
      signals_json: null,
    });

    // Bounds: excerpt, signals blob, content hash, error code, http status.
    expect(() =>
      insertObservation(db, { id: "obs-long-excerpt", excerpt: "x".repeat(1001) }),
    ).toThrow();
    expect(() =>
      insertObservation(db, {
        id: "obs-big-signals",
        signals_json: JSON.stringify({ title: "t".repeat(12000) }),
      }),
    ).toThrow();
    expect(() =>
      insertObservation(db, { id: "obs-long-hash", content_hash: "h".repeat(129) }),
    ).toThrow();
    expect(() =>
      insertObservation(db, { id: "obs-long-err", fetch_error_code: "e".repeat(65) }),
    ).toThrow();
    expect(() =>
      insertObservation(db, { id: "obs-bad-http", http_status: 99 }),
    ).toThrow();
    expect(() =>
      insertObservation(db, { id: "obs-bad-http2", http_status: 600 }),
    ).toThrow();

    // Unknown vocabularies are rejected.
    expect(() =>
      insertObservation(db, { id: "obs-bad-status", fetch_status: "timed_out" }),
    ).toThrow();
    expect(() =>
      insertObservation(db, { id: "obs-bad-kind", page_kind: "newsletter" }),
    ).toThrow();
    expect(() =>
      insertObservation(db, { id: "obs-bad-source", discovery_source: "dns_scan" }),
    ).toThrow();

    // Foreign keys: unknown run, proof capture, and workspace are rejected.
    expect(() =>
      insertObservation(db, { id: "obs-bad-run", watchlist_run_id: "missing-run" }),
    ).toThrow();
    expect(() =>
      insertObservation(db, { id: "obs-bad-proof", proof_capture_id: "missing-proof" }),
    ).toThrow();
    expect(() =>
      insertObservation(db, { id: "obs-bad-ws", workspace_id: "missing-user" }),
    ).toThrow();

    // One canonical row per URL per run; same URL is fine in another run or watchlist.
    expect(() =>
      insertObservation(db, { id: "obs-dup", canonical_url: "https://competitor.example/" }),
    ).toThrow();
    db.prepare(
      `INSERT INTO watchlist_run (
         id, watchlist_id, trigger_type, status, page_budget, pages_scanned,
         summary_json, started_at, created_at, updated_at
       ) VALUES ('run-2', 'watch-1', 'manual', 'succeeded', 3, 3, '{}', ?, ?, ?)`,
    ).run("2026-08-03T01:00:00.000Z", "2026-08-03T01:00:00.000Z", "2026-08-03T01:00:00.000Z");
    insertObservation(db, {
      id: "obs-run2",
      watchlist_run_id: "run-2",
      observed_at: "2026-08-03T02:00:00.000Z",
      created_at: "2026-08-03T02:00:00.000Z",
      updated_at: "2026-08-03T02:00:00.000Z",
    });

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("replays the full 0000..0075 migration chain cleanly", () => {
    // Proven convention: the D1 harness opens with foreign keys ON and every
    // migration replays against it (0001/0000 set them ON; rebuild migrations
    // toggle them OFF/ON themselves).
    const db = createSqliteD1().sqlite;
    databases.push(db);

    const migrationFiles = readdirSync("migrations")
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of migrationFiles) {
      applyMigration(db, `migrations/${file}`);
    }

    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    for (const table of [
      "website_site_scan",
      "website_site_scan_page",
      "website_page_observation",
    ]) {
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
      ).toEqual({ name: table });
    }
  });
});

