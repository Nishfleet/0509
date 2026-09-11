-- Generalize signup attribution (issue #2108): signup_source moves from six
-- hardcoded literals to an open, shape-checked allowlist — NULL, the existing
-- literals ('pricing-free' and 'for_agencies', which the code allowlist
-- already accepted but the 0080 CHECK rejected, plus 'digest_footer', the
-- underscore-bearing free-brief footer marker added for issue #2146), the two
-- underscore-bearing live
-- markers 'search_warming_exhausted' and 'guide_track_ads' (which the code
-- exact-match branch accepts but the open shape's [a-z0-9:.-] class would
-- reject), lowercase slugs, and `ref:<eTLD+1>` referer markers. The open
-- rule mirrors the code rule in app/lib/signup-source.ts: 1-44 chars, only
-- [a-z0-9:.-] — no whitespace, no uppercase, no query strings, no full URLs. SQLite cannot ALTER a CHECK in
-- place, so both tables are rebuilt: create the replacement, copy, drop the
-- old table, rename, recreate indexes. `user` is referenced by many child
-- tables (session, account, passkey, watchlist, ...), so the rename-first
-- order is deliberately NOT used: renaming `user` rewrites every child
-- table's REFERENCES clause to the rename target and strands them on the
-- dropped table. Creating `user_new` and renaming it INTO place leaves child
-- references on `user` untouched. Expand-only: every value the old CHECKs
-- accepted is still accepted, so existing rows copy through unchanged.
--
-- Rewrite for issue #2774 (fleet-ops#4999): this file previously opened with
-- `PRAGMA foreign_keys = OFF;`, which is a no-op inside the transaction D1
-- wraps each migration in. `DROP TABLE user` then ran an implicit
-- `DELETE FROM user` with enforcement ON, and every
-- `REFERENCES user(id) ON DELETE CASCADE` descendant emptied (57 tables
-- wiped in production on 2026-09-09). `PRAGMA defer_foreign_keys` alone does
-- NOT save them either: the drop's cascades are queued at mark time and
-- execute unconditionally at COMMIT.
--
-- The rebuild therefore keeps the identical shape but stages every table in
-- the transitive ON DELETE CASCADE closure of `user` first, then restores
-- each one after the rename:
--   1. `CREATE TABLE mig0087_<t> AS SELECT * FROM <t>` snapshots the 57
--      cascade-reachable tables (computed from pragma_foreign_key_list over
--      the pre-0087 schema — every path into the closure is CASCADE or an
--      in-closure SET NULL, so the drop cannot hit a RESTRICT/NO ACTION
--      abort and cannot null a column in a surviving table).
--   2. The `user` rebuild runs unchanged; the drop still cascades, but only
--      into rows that exist verbatim in staging.
--   3. `INSERT INTO <t> SELECT * FROM mig0087_<t>` repopulates each table.
--      `defer_foreign_keys` (honoured inside a transaction, and the
--      documented D1 mechanism) defers the restore-time FK checks to COMMIT,
--      so restore order does not matter and any forgotten staging table
--      fails the commit loudly instead of passing silently.
-- The resulting schema is identical to the pre-rewrite file: same `user`
-- definition, same index, same signup_source_pending rebuild. Only the
-- survival of account-scoped rows changed.

PRAGMA defer_foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Stage every table transitively reachable from `user` via ON DELETE CASCADE.
-- ---------------------------------------------------------------------------

CREATE TABLE mig0087_account AS SELECT * FROM account;
CREATE TABLE mig0087_ad_observation AS SELECT * FROM ad_observation;
CREATE TABLE mig0087_agent_action_audit AS SELECT * FROM agent_action_audit;
CREATE TABLE mig0087_agent_memory AS SELECT * FROM agent_memory;
CREATE TABLE mig0087_client_room AS SELECT * FROM client_room;
CREATE TABLE mig0087_client_room_resource AS SELECT * FROM client_room_resource;
CREATE TABLE mig0087_collection AS SELECT * FROM collection;
CREATE TABLE mig0087_collection_item AS SELECT * FROM collection_item;
CREATE TABLE mig0087_collection_item_tag AS SELECT * FROM collection_item_tag;
CREATE TABLE mig0087_customer_api_key AS SELECT * FROM customer_api_key;
CREATE TABLE mig0087_customer_meta_connection AS SELECT * FROM customer_meta_connection;
CREATE TABLE mig0087_delivery_attempt AS SELECT * FROM delivery_attempt;
CREATE TABLE mig0087_delivery_target AS SELECT * FROM delivery_target;
CREATE TABLE mig0087_digest_delivery AS SELECT * FROM digest_delivery;
CREATE TABLE mig0087_digest_item AS SELECT * FROM digest_item;
CREATE TABLE mig0087_digest_run AS SELECT * FROM digest_run;
CREATE TABLE mig0087_digest_schedule_job AS SELECT * FROM digest_schedule_job;
CREATE TABLE mig0087_event_candidate AS SELECT * FROM event_candidate;
CREATE TABLE mig0087_evidence_top_up_adjustment AS SELECT * FROM evidence_top_up_adjustment;
CREATE TABLE mig0087_evidence_top_up_grant AS SELECT * FROM evidence_top_up_grant;
CREATE TABLE mig0087_evidence_top_up_ledger_entry AS SELECT * FROM evidence_top_up_ledger_entry;
CREATE TABLE mig0087_evidence_usage_period AS SELECT * FROM evidence_usage_period;
CREATE TABLE mig0087_evidence_usage_reservation AS SELECT * FROM evidence_usage_reservation;
CREATE TABLE mig0087_passkey AS SELECT * FROM passkey;
CREATE TABLE mig0087_presence_alert_cursor AS SELECT * FROM presence_alert_cursor;
CREATE TABLE mig0087_presence_domain_verification AS SELECT * FROM presence_domain_verification;
CREATE TABLE mig0087_presence_entity_link AS SELECT * FROM presence_entity_link;
CREATE TABLE mig0087_presence_item AS SELECT * FROM presence_item;
CREATE TABLE mig0087_presence_item_revision AS SELECT * FROM presence_item_revision;
CREATE TABLE mig0087_presence_oauth_transaction AS SELECT * FROM presence_oauth_transaction;
CREATE TABLE mig0087_presence_poll_cursor AS SELECT * FROM presence_poll_cursor;
CREATE TABLE mig0087_proof_capture AS SELECT * FROM proof_capture;
CREATE TABLE mig0087_proof_target AS SELECT * FROM proof_target;
CREATE TABLE mig0087_proof_usage_credit AS SELECT * FROM proof_usage_credit;
CREATE TABLE mig0087_proof_usage_credit_migration AS SELECT * FROM proof_usage_credit_migration;
CREATE TABLE mig0087_saved_query AS SELECT * FROM saved_query;
CREATE TABLE mig0087_session AS SELECT * FROM session;
CREATE TABLE mig0087_share_link AS SELECT * FROM share_link;
CREATE TABLE mig0087_source_connection AS SELECT * FROM source_connection;
CREATE TABLE mig0087_source_target AS SELECT * FROM source_target;
CREATE TABLE mig0087_support_case AS SELECT * FROM support_case;
CREATE TABLE mig0087_support_case_event AS SELECT * FROM support_case_event;
CREATE TABLE mig0087_tag AS SELECT * FROM tag;
CREATE TABLE mig0087_tracked_entity AS SELECT * FROM tracked_entity;
CREATE TABLE mig0087_user_plan AS SELECT * FROM user_plan;
CREATE TABLE mig0087_watch_event AS SELECT * FROM watch_event;
CREATE TABLE mig0087_watchlist AS SELECT * FROM watchlist;
CREATE TABLE mig0087_watchlist_delivery_config AS SELECT * FROM watchlist_delivery_config;
CREATE TABLE mig0087_watchlist_run AS SELECT * FROM watchlist_run;
CREATE TABLE mig0087_web_mention_observation AS SELECT * FROM web_mention_observation;
CREATE TABLE mig0087_web_mention_target AS SELECT * FROM web_mention_target;
CREATE TABLE mig0087_website_page_observation AS SELECT * FROM website_page_observation;
CREATE TABLE mig0087_website_site_scan AS SELECT * FROM website_site_scan;
CREATE TABLE mig0087_website_site_scan_page AS SELECT * FROM website_site_scan_page;
CREATE TABLE mig0087_workspace_branding AS SELECT * FROM workspace_branding;
CREATE TABLE mig0087_workspace_delivery_config AS SELECT * FROM workspace_delivery_config;
CREATE TABLE mig0087_workspace_member AS SELECT * FROM workspace_member;

-- ---------------------------------------------------------------------------
-- user: rebuild with the expanded signup_source CHECK. Column list mirrors
-- 0000_auth.sql + 0005_onboarding.sql (onboardedAt) + 0080 (signup_source).
-- ---------------------------------------------------------------------------

CREATE TABLE user_new (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  onboardedAt TEXT,
  signup_source TEXT CHECK (
    signup_source IS NULL
    OR signup_source IN (
      'magicbrief-migration',
      'locale-en-sneaker-resale',
      'locale-de-sneaker-resale',
      'locale-ja-sneaker-resale',
      'locale-pt-br-sneaker-resale',
      'pricing-free',
      'for_agencies',
      'digest_footer',
      'search_warming_exhausted',
      'guide_track_ads'
    )
    OR (
      length(signup_source) BETWEEN 1 AND 44
      AND signup_source NOT GLOB '*[^a-z0-9:.-]*'
    )
  )
);

INSERT INTO user_new (
  id,
  name,
  email,
  emailVerified,
  image,
  createdAt,
  updatedAt,
  onboardedAt,
  signup_source
)
SELECT
  id,
  name,
  email,
  emailVerified,
  image,
  createdAt,
  updatedAt,
  onboardedAt,
  signup_source
FROM user;

DROP TABLE user;

ALTER TABLE user_new RENAME TO user;

-- 0022_hot_path_indexes.sql: the Dodo webhook email lookup index rides along
-- with the rebuild.
CREATE INDEX IF NOT EXISTS idx_user_email_nocase
  ON user(email COLLATE NOCASE);

-- ---------------------------------------------------------------------------
-- signup_source_pending: rebuild with the same expanded CHECK (NOT NULL kept).
-- No table references signup_source_pending, so its drop fires no cascade.
-- ---------------------------------------------------------------------------

CREATE TABLE signup_source_pending_new (
  email TEXT PRIMARY KEY NOT NULL,
  signup_source TEXT NOT NULL CHECK (
    signup_source IN (
      'magicbrief-migration',
      'locale-en-sneaker-resale',
      'locale-de-sneaker-resale',
      'locale-ja-sneaker-resale',
      'locale-pt-br-sneaker-resale',
      'pricing-free',
      'for_agencies',
      'digest_footer',
      'search_warming_exhausted',
      'guide_track_ads'
    )
    OR (
      length(signup_source) BETWEEN 1 AND 44
      AND signup_source NOT GLOB '*[^a-z0-9:.-]*'
    )
  ),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

INSERT INTO signup_source_pending_new (
  email,
  signup_source,
  created_at,
  expires_at
)
SELECT
  email,
  signup_source,
  created_at,
  expires_at
FROM signup_source_pending;

DROP TABLE signup_source_pending;

ALTER TABLE signup_source_pending_new RENAME TO signup_source_pending;

CREATE INDEX IF NOT EXISTS idx_signup_source_pending_expires
  ON signup_source_pending(expires_at);

-- ---------------------------------------------------------------------------
-- Restore the staged cascade-closure rows, then drop the staging tables.
-- ---------------------------------------------------------------------------

INSERT INTO account SELECT * FROM mig0087_account;
DROP TABLE mig0087_account;
INSERT INTO ad_observation SELECT * FROM mig0087_ad_observation;
DROP TABLE mig0087_ad_observation;
INSERT INTO agent_action_audit SELECT * FROM mig0087_agent_action_audit;
DROP TABLE mig0087_agent_action_audit;
INSERT INTO agent_memory SELECT * FROM mig0087_agent_memory;
DROP TABLE mig0087_agent_memory;
INSERT INTO client_room SELECT * FROM mig0087_client_room;
DROP TABLE mig0087_client_room;
INSERT INTO client_room_resource SELECT * FROM mig0087_client_room_resource;
DROP TABLE mig0087_client_room_resource;
INSERT INTO collection SELECT * FROM mig0087_collection;
DROP TABLE mig0087_collection;
INSERT INTO collection_item SELECT * FROM mig0087_collection_item;
DROP TABLE mig0087_collection_item;
INSERT INTO collection_item_tag SELECT * FROM mig0087_collection_item_tag;
DROP TABLE mig0087_collection_item_tag;
INSERT INTO customer_api_key SELECT * FROM mig0087_customer_api_key;
DROP TABLE mig0087_customer_api_key;
INSERT INTO customer_meta_connection SELECT * FROM mig0087_customer_meta_connection;
DROP TABLE mig0087_customer_meta_connection;
INSERT INTO delivery_attempt SELECT * FROM mig0087_delivery_attempt;
DROP TABLE mig0087_delivery_attempt;
INSERT INTO delivery_target SELECT * FROM mig0087_delivery_target;
DROP TABLE mig0087_delivery_target;
INSERT INTO digest_delivery SELECT * FROM mig0087_digest_delivery;
DROP TABLE mig0087_digest_delivery;
INSERT INTO digest_item SELECT * FROM mig0087_digest_item;
DROP TABLE mig0087_digest_item;
INSERT INTO digest_run SELECT * FROM mig0087_digest_run;
DROP TABLE mig0087_digest_run;
INSERT INTO digest_schedule_job SELECT * FROM mig0087_digest_schedule_job;
DROP TABLE mig0087_digest_schedule_job;
INSERT INTO event_candidate SELECT * FROM mig0087_event_candidate;
DROP TABLE mig0087_event_candidate;
INSERT INTO evidence_top_up_adjustment SELECT * FROM mig0087_evidence_top_up_adjustment;
DROP TABLE mig0087_evidence_top_up_adjustment;
INSERT INTO evidence_top_up_grant SELECT * FROM mig0087_evidence_top_up_grant;
DROP TABLE mig0087_evidence_top_up_grant;
INSERT INTO evidence_top_up_ledger_entry SELECT * FROM mig0087_evidence_top_up_ledger_entry;
DROP TABLE mig0087_evidence_top_up_ledger_entry;
INSERT INTO evidence_usage_period SELECT * FROM mig0087_evidence_usage_period;
DROP TABLE mig0087_evidence_usage_period;
INSERT INTO evidence_usage_reservation SELECT * FROM mig0087_evidence_usage_reservation;
DROP TABLE mig0087_evidence_usage_reservation;
INSERT INTO passkey SELECT * FROM mig0087_passkey;
DROP TABLE mig0087_passkey;
INSERT INTO presence_alert_cursor SELECT * FROM mig0087_presence_alert_cursor;
DROP TABLE mig0087_presence_alert_cursor;
INSERT INTO presence_domain_verification SELECT * FROM mig0087_presence_domain_verification;
DROP TABLE mig0087_presence_domain_verification;
INSERT INTO presence_entity_link SELECT * FROM mig0087_presence_entity_link;
DROP TABLE mig0087_presence_entity_link;
INSERT INTO presence_item SELECT * FROM mig0087_presence_item;
DROP TABLE mig0087_presence_item;
INSERT INTO presence_item_revision SELECT * FROM mig0087_presence_item_revision;
DROP TABLE mig0087_presence_item_revision;
INSERT INTO presence_oauth_transaction SELECT * FROM mig0087_presence_oauth_transaction;
DROP TABLE mig0087_presence_oauth_transaction;
INSERT INTO presence_poll_cursor SELECT * FROM mig0087_presence_poll_cursor;
DROP TABLE mig0087_presence_poll_cursor;
INSERT INTO proof_capture SELECT * FROM mig0087_proof_capture;
DROP TABLE mig0087_proof_capture;
INSERT INTO proof_target SELECT * FROM mig0087_proof_target;
DROP TABLE mig0087_proof_target;
INSERT INTO proof_usage_credit SELECT * FROM mig0087_proof_usage_credit;
DROP TABLE mig0087_proof_usage_credit;
INSERT INTO proof_usage_credit_migration SELECT * FROM mig0087_proof_usage_credit_migration;
DROP TABLE mig0087_proof_usage_credit_migration;
INSERT INTO saved_query SELECT * FROM mig0087_saved_query;
DROP TABLE mig0087_saved_query;
INSERT INTO session SELECT * FROM mig0087_session;
DROP TABLE mig0087_session;
INSERT INTO share_link SELECT * FROM mig0087_share_link;
DROP TABLE mig0087_share_link;
INSERT INTO source_connection SELECT * FROM mig0087_source_connection;
DROP TABLE mig0087_source_connection;
INSERT INTO source_target SELECT * FROM mig0087_source_target;
DROP TABLE mig0087_source_target;
INSERT INTO support_case SELECT * FROM mig0087_support_case;
DROP TABLE mig0087_support_case;
INSERT INTO support_case_event SELECT * FROM mig0087_support_case_event;
DROP TABLE mig0087_support_case_event;
INSERT INTO tag SELECT * FROM mig0087_tag;
DROP TABLE mig0087_tag;
INSERT INTO tracked_entity SELECT * FROM mig0087_tracked_entity;
DROP TABLE mig0087_tracked_entity;
INSERT INTO user_plan SELECT * FROM mig0087_user_plan;
DROP TABLE mig0087_user_plan;
INSERT INTO watch_event SELECT * FROM mig0087_watch_event;
DROP TABLE mig0087_watch_event;
INSERT INTO watchlist SELECT * FROM mig0087_watchlist;
DROP TABLE mig0087_watchlist;
INSERT INTO watchlist_delivery_config SELECT * FROM mig0087_watchlist_delivery_config;
DROP TABLE mig0087_watchlist_delivery_config;
INSERT INTO watchlist_run SELECT * FROM mig0087_watchlist_run;
DROP TABLE mig0087_watchlist_run;
INSERT INTO web_mention_observation SELECT * FROM mig0087_web_mention_observation;
DROP TABLE mig0087_web_mention_observation;
INSERT INTO web_mention_target SELECT * FROM mig0087_web_mention_target;
DROP TABLE mig0087_web_mention_target;
INSERT INTO website_page_observation SELECT * FROM mig0087_website_page_observation;
DROP TABLE mig0087_website_page_observation;
INSERT INTO website_site_scan SELECT * FROM mig0087_website_site_scan;
DROP TABLE mig0087_website_site_scan;
INSERT INTO website_site_scan_page SELECT * FROM mig0087_website_site_scan_page;
DROP TABLE mig0087_website_site_scan_page;
INSERT INTO workspace_branding SELECT * FROM mig0087_workspace_branding;
DROP TABLE mig0087_workspace_branding;
INSERT INTO workspace_delivery_config SELECT * FROM mig0087_workspace_delivery_config;
DROP TABLE mig0087_workspace_delivery_config;
INSERT INTO workspace_member SELECT * FROM mig0087_workspace_member;
DROP TABLE mig0087_workspace_member;

PRAGMA defer_foreign_keys = OFF;
