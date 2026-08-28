PRAGMA foreign_keys = OFF;

-- This file is also safe to re-run manually. The normal harness deletes the
-- dedicated .wrangler/e2e-* persistence root before migrations and seeding,
-- so a partial seed can never be served as a completed fixture.
DELETE FROM collection_item_tag WHERE collection_item_id IN (
  SELECT item.id FROM collection_item item JOIN collection parent ON parent.id = item.collection_id WHERE parent.user_id LIKE 'e2e-%'
);
DELETE FROM presence_item_revision WHERE presence_item_id IN (SELECT id FROM presence_item WHERE user_id LIKE 'e2e-%');
DELETE FROM support_case_event WHERE user_id LIKE 'e2e-%' OR case_id IN (SELECT id FROM support_case WHERE user_id LIKE 'e2e-%');
DELETE FROM client_room_resource WHERE user_id LIKE 'e2e-%' OR room_id IN (SELECT id FROM client_room WHERE user_id LIKE 'e2e-%');
DELETE FROM agent_memory WHERE user_id LIKE 'e2e-%';
DELETE FROM evidence_top_up_adjustment WHERE workspace_user_id LIKE 'e2e-%' OR grant_id IN (SELECT id FROM evidence_top_up_grant WHERE workspace_user_id LIKE 'e2e-%');
DELETE FROM evidence_top_up_ledger_entry WHERE workspace_user_id LIKE 'e2e-%' OR grant_id IN (SELECT id FROM evidence_top_up_grant WHERE workspace_user_id LIKE 'e2e-%');
DELETE FROM proof_usage_credit_migration WHERE workspace_user_id LIKE 'e2e-%' OR grant_id IN (SELECT id FROM evidence_top_up_grant WHERE workspace_user_id LIKE 'e2e-%');
DELETE FROM evidence_usage_reservation WHERE workspace_user_id LIKE 'e2e-%';
DELETE FROM digest_delivery WHERE digest_run_id IN (SELECT id FROM digest_run WHERE user_id LIKE 'e2e-%');
DELETE FROM digest_item WHERE digest_run_id IN (SELECT id FROM digest_run WHERE user_id LIKE 'e2e-%');
DELETE FROM delivery_attempt WHERE user_id LIKE 'e2e-%';
DELETE FROM watch_event WHERE watchlist_id IN (SELECT id FROM watchlist WHERE user_id LIKE 'e2e-%');
DELETE FROM event_candidate WHERE watchlist_id IN (SELECT id FROM watchlist WHERE user_id LIKE 'e2e-%');
DELETE FROM ad_observation WHERE watchlist_run_id IN (
  SELECT run.id FROM watchlist_run run JOIN watchlist parent ON parent.id = run.watchlist_id WHERE parent.user_id LIKE 'e2e-%'
);
DELETE FROM proof_capture WHERE proof_target_id IN (
  SELECT target.id FROM proof_target target JOIN watchlist parent ON parent.id = target.watchlist_id WHERE parent.user_id LIKE 'e2e-%'
);
DELETE FROM presence_item WHERE user_id LIKE 'e2e-%';
DELETE FROM presence_poll_cursor WHERE source_target_id IN (SELECT id FROM source_target WHERE user_id LIKE 'e2e-%');
DELETE FROM presence_entity_link WHERE user_id LIKE 'e2e-%';
DELETE FROM presence_alert_cursor WHERE user_id LIKE 'e2e-%';
DELETE FROM presence_domain_verification WHERE user_id LIKE 'e2e-%';
DELETE FROM source_connection WHERE user_id LIKE 'e2e-%';
DELETE FROM watchlist_delivery_config WHERE user_id LIKE 'e2e-%';
DELETE FROM proof_target WHERE watchlist_id IN (SELECT id FROM watchlist WHERE user_id LIKE 'e2e-%');
DELETE FROM web_mention_observation WHERE user_id LIKE 'e2e-%';
DELETE FROM web_mention_target WHERE user_id LIKE 'e2e-%';
DELETE FROM client_room WHERE user_id LIKE 'e2e-%';
DELETE FROM support_case WHERE user_id LIKE 'e2e-%';
DELETE FROM delivery_target WHERE user_id LIKE 'e2e-%';
DELETE FROM collection_item WHERE collection_id IN (SELECT id FROM collection WHERE user_id LIKE 'e2e-%');
DELETE FROM watchlist_run WHERE watchlist_id IN (SELECT id FROM watchlist WHERE user_id LIKE 'e2e-%');
DELETE FROM evidence_top_up_grant WHERE workspace_user_id LIKE 'e2e-%';
DELETE FROM evidence_usage_period WHERE workspace_user_id LIKE 'e2e-%';
DELETE FROM source_target WHERE user_id LIKE 'e2e-%';
DELETE FROM tracked_entity WHERE user_id LIKE 'e2e-%';
DELETE FROM collection WHERE user_id LIKE 'e2e-%';
DELETE FROM watchlist WHERE user_id LIKE 'e2e-%';
DELETE FROM saved_query WHERE user_id LIKE 'e2e-%';
DELETE FROM tag WHERE user_id LIKE 'e2e-%';
DELETE FROM ad WHERE id LIKE 'e2e-%';
DELETE FROM digest_run WHERE user_id LIKE 'e2e-%';
DELETE FROM workspace_delivery_config WHERE user_id LIKE 'e2e-%';
DELETE FROM workspace_branding WHERE user_id LIKE 'e2e-%';
DELETE FROM customer_api_key WHERE user_id LIKE 'e2e-%';
DELETE FROM customer_meta_connection WHERE user_id LIKE 'e2e-%';
DELETE FROM proof_usage_credit WHERE user_id LIKE 'e2e-%';
DELETE FROM share_link WHERE user_id LIKE 'e2e-%';
DELETE FROM presence_oauth_transaction WHERE user_id LIKE 'e2e-%' OR workspace_user_id LIKE 'e2e-%';
DELETE FROM agent_action_audit WHERE user_id LIKE 'e2e-%';
DELETE FROM workspace_member WHERE owner_user_id LIKE 'e2e-%' OR member_user_id LIKE 'e2e-%';
DELETE FROM dodo_webhook_event WHERE user_id LIKE 'e2e-%' OR event_id LIKE 'e2e-%';
DELETE FROM session WHERE userId LIKE 'e2e-%';
DELETE FROM account WHERE userId LIKE 'e2e-%';
DELETE FROM passkey WHERE userId LIKE 'e2e-%';
DELETE FROM user_plan WHERE user_id LIKE 'e2e-%';
DELETE FROM user WHERE id LIKE 'e2e-%';
DELETE FROM discovery_cache_entry WHERE cache_key LIKE 'search-v2:domain:%e2e%' OR query_fingerprint LIKE 'e2e-%';
DELETE FROM discovery_fetch_log WHERE id LIKE 'e2e-%' OR query_fingerprint LIKE 'e2e-%';
DELETE FROM discovery_query_lease WHERE holder_id LIKE 'e2e-%' OR cache_key LIKE 'search-v2:domain:%e2e%';
DELETE FROM discovery_provider_state WHERE provider = 'e2e_replay';

DROP TABLE IF EXISTS e2e_test_mode;
CREATE TABLE e2e_test_mode (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO e2e_test_mode (id, enabled, created_at) VALUES
  ('local-authenticated', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

DROP TABLE IF EXISTS e2e_j3_replay;
CREATE TABLE e2e_j3_replay (
  idempotency_key TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  user_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded')),
  processing_token TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

DROP TABLE IF EXISTS e2e_j4_replay;
CREATE TABLE e2e_j4_replay (
  idempotency_key TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('report_share', 'client_room', 'batch_failure', 'approval_stale')),
  user_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded')),
  processing_token TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

DROP TABLE IF EXISTS e2e_j6_replay;
CREATE TABLE e2e_j6_replay (
  idempotency_key TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('failure', 'recovery', 'team_membership')),
  user_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded')),
  processing_token TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

PRAGMA foreign_keys = ON;

INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, onboardedAt) VALUES
  ('e2e-free', 'E2E Free', 'e2e-free@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL),
  ('e2e-free-onboarded', 'E2E Free Onboarded', 'e2e-free-onboarded@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-13 days')),
  ('e2e-activation', 'E2E Activation', 'e2e-activation@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL),
  ('e2e-activation-tablet', 'E2E Activation Tablet', 'e2e-activation-tablet@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL),
  ('e2e-activation-desktop', 'E2E Activation Desktop', 'e2e-activation-desktop@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL),
  ('e2e-scout', 'E2E Scout', 'e2e-scout@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-13 days')),
  ('e2e-starter', 'E2E Starter', 'e2e-starter@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-13 days')),
  ('e2e-agency', 'E2E Agency', 'e2e-agency@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-13 days')),
  ('e2e-agency-unbranded', 'E2E Agency Unbranded', 'e2e-agency-unbranded@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-13 days')),
  -- Paid Starter whose Dodo status is subscription.expired. Needed so an
  -- authenticated surface audit can render billing as that viewer.
  ('e2e-expired', 'E2E Expired', 'e2e-expired@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-29 days')),
  ('e2e-downgraded', 'E2E Downgraded', 'e2e-downgraded@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-13 days')),
  ('e2e-removed-member', 'E2E Removed Member', 'e2e-removed-member@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-13 days')),
  ('e2e-payment-issue', 'E2E Payment Issue', 'e2e-payment-issue@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-13 days')),
  ('e2e-payment-issue-tablet', 'E2E Payment Issue Tablet', 'e2e-payment-issue-tablet@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-13 days')),
  ('e2e-payment-issue-desktop', 'E2E Payment Issue Desktop', 'e2e-payment-issue-desktop@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-13 days')),
  ('e2e-cancelled', 'E2E Cancelled', 'e2e-cancelled@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-13 days')),
  ('e2e-cancelled-tablet', 'E2E Cancelled Tablet', 'e2e-cancelled-tablet@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-13 days')),
  ('e2e-cancelled-desktop', 'E2E Cancelled Desktop', 'e2e-cancelled-desktop@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-13 days')),
  ('e2e-refunded', 'E2E Refunded', 'e2e-refunded@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-13 days')),
  ('e2e-refunded-tablet', 'E2E Refunded Tablet', 'e2e-refunded-tablet@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-13 days')),
  ('e2e-refunded-desktop', 'E2E Refunded Desktop', 'e2e-refunded-desktop@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-13 days')),
  ('e2e-active-member', 'E2E Active Member', 'e2e-active-member@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-9 days')),
  ('e2e-ops', 'E2E Ops', 'e2e-ops@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-9 days')),
  ('e2e-support-recovery', 'E2E Support Recovery', 'e2e-support-recovery@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-9 days'));

INSERT INTO user_plan (user_id, plan, plan_updated_at, dodo_payment_id, dodo_product_id, dodo_status, dodo_subscription_id, dodo_customer_id, dodo_next_billing_at, evidence_entitlement_anchor, evidence_entitlement_anchor_source) VALUES
  ('e2e-free', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e2e-free-onboarded', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e2e-activation', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e2e-activation-tablet', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e2e-activation-desktop', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e2e-scout', 'scout', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'pay_e2e_scout', 'prod_e2e_scout_monthly', 'subscription.active', 'sub_e2e_scout', 'cus_e2e_scout', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), 'e2e'),
  ('e2e-starter', 'starter', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'pay_e2e_starter', 'prod_e2e_starter_monthly', 'subscription.active', 'sub_e2e_starter', 'cus_e2e_starter', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), 'e2e'),
  ('e2e-agency', 'agency', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'pay_e2e_agency', 'prod_e2e_agency_monthly', 'subscription.active', 'sub_e2e_agency', 'cus_e2e_agency', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), 'e2e'),
  ('e2e-agency-unbranded', 'agency', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'pay_e2e_agency_unbranded', 'prod_e2e_agency_monthly', 'subscription.active', 'sub_e2e_agency_unbranded', 'cus_e2e_agency_unbranded', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), 'e2e'),
  ('e2e-expired', 'starter', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'pay_e2e_expired', 'prod_e2e_starter_monthly', 'subscription.expired', 'sub_e2e_expired', 'cus_e2e_expired', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), 'e2e'),
  ('e2e-downgraded', 'scout', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'pay_e2e_downgraded', 'prod_e2e_scout_monthly', 'subscription.active', 'sub_e2e_downgraded', 'cus_e2e_downgraded', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), 'e2e'),
  ('e2e-removed-member', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e2e-payment-issue', 'starter', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'e2e-j5-pay-payment-issue', 'e2e-j5-product-starter-monthly', 'active', 'e2e-j5-sub-e2e-payment-issue', 'e2e-j5-cus-e2e-payment-issue', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), 'e2e'),
  ('e2e-payment-issue-tablet', 'starter', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'e2e-j5-pay-payment-issue-tablet', 'e2e-j5-product-starter-monthly', 'active', 'e2e-j5-sub-e2e-payment-issue-tablet', 'e2e-j5-cus-e2e-payment-issue-tablet', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), 'e2e'),
  ('e2e-payment-issue-desktop', 'starter', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'e2e-j5-pay-payment-issue-desktop', 'e2e-j5-product-starter-monthly', 'active', 'e2e-j5-sub-e2e-payment-issue-desktop', 'e2e-j5-cus-e2e-payment-issue-desktop', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), 'e2e'),
  ('e2e-cancelled', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e2e-cancelled-tablet', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e2e-cancelled-desktop', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e2e-refunded', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e2e-refunded-tablet', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e2e-refunded-desktop', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e2e-active-member', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e2e-ops', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e2e-support-recovery', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

-- The ordinary E2E server keeps Presence disabled. BL-034's opt-in capture
-- switches to pilot rollout so each real plan shape, including the Free lock,
-- can be rendered without weakening the production access gate.
INSERT INTO presence_pilot_workspace (workspace_id_hash, invited_at, invited_by, notes, revoked_at) VALUES
  ('xxdEN4qKgyUC63z-jrlzSFsfjUSGb__mn8KwoP44xBE', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'bl034-capture', 'E2E Free Presence landing-language capture.', NULL),
  ('puMOELosW_e1o9-peJaO03gLJghwS1j2o9F2qQEuhwU', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'bl034-capture', 'E2E Scout Presence landing-language capture.', NULL),
  ('ipb72GO-WQGR_xPjqR2BQmlJve2SGSXYPtyenTGuuFM', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'bl034-capture', 'E2E Starter Presence landing-language capture.', NULL),
  ('a2FYRL0GgCwMHWZ9nfV7Np4h1DEB2QPUlRKA05Otntg', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'bl034-capture', 'E2E Agency Presence landing-language capture.', NULL);

INSERT INTO dodo_webhook_event (event_id, event_type, user_id, received_at, payload_timestamp, processed_at, outcome, metadata_json, processing_started_at) VALUES
  ('e2e-webhook-payment-issue', 'payment.failed', 'e2e-payment-issue', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'), 'processed', '{"fixture":true}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('e2e-webhook-cancelled', 'subscription.cancelled', 'e2e-cancelled', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), 'processed', '{"fixture":true}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')),
  ('e2e-webhook-refunded', 'refund.succeeded', 'e2e-refunded', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), 'processed', '{"fixture":true}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'));

INSERT INTO workspace_branding (user_id, brand_name, brand_website, updated_at) VALUES
  ('e2e-starter', 'Starter Fixture Studio', 'https://starter.example.invalid', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('e2e-agency', 'Agency Fixture Studio', 'https://agency.example.invalid', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO workspace_delivery_config (id, user_id, sensitivity_mode, instant_enabled, digest_enabled, email_enabled, whatsapp_enabled, quiet_hours_json, timezone, created_at, updated_at, slack_enabled) VALUES
  ('e2e-delivery-config-starter', 'e2e-starter', 'balanced', 1, 1, 1, 0, '{"startHour":22,"endHour":8}', 'Asia/Kolkata', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0);

INSERT INTO saved_query (id, user_id, name, mode, query_text, normalized_query_json, fingerprint, run_count, last_run_at, created_at, updated_at) VALUES
  ('e2e-query-starter-1', 'e2e-starter', 'Okara India ads', 'advertiser', 'okara.ai', '{"mode":"advertiser","filters":{"query":"okara.ai","country":"IN","platform":"all","creativeType":"all","status":"active","firstSeenFrom":"","lastSeenFrom":""}}', 'e2e-query-starter-1', 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')),
  ('e2e-query-j3-workflow', 'e2e-starter', 'J3 Workflow acceptance', 'advertiser', 'workflow.example.invalid', '{"mode":"advertiser","filters":{"query":"workflow.example.invalid","country":"IN","platform":"all","creativeType":"all","status":"active","firstSeenFrom":"","lastSeenFrom":""}}', 'e2e-query-j3-workflow', 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('e2e-query-j3-crash', 'e2e-starter', 'J3 crash reclaim', 'advertiser', 'crash.example.invalid', '{"mode":"advertiser","filters":{"query":"crash.example.invalid","country":"IN","platform":"all","creativeType":"all","status":"active","firstSeenFrom":"","lastSeenFrom":""}}', 'e2e-query-j3-crash', 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, last_scanned_at, created_at, updated_at, paused_reason, target_country, tracking_role) VALUES
  ('e2e-watchlist-starter-1', 'e2e-starter', 'Okara competitor watch', 'saved_query', 'e2e-query-starter-1', 'e2e-query-starter-1', 'Okara', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), NULL, 'IN', 'competitor'),
  ('e2e-watchlist-scout-1', 'e2e-scout', 'Scout weekly watch', 'advertiser', 'scout.example.invalid', 'e2e-scout-watch', 'Scout Fixture', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), NULL, 'IN', 'competitor'),
  ('e2e-watchlist-agency-1', 'e2e-agency', 'Agency client proof watch', 'advertiser', 'okara.example.invalid', 'e2e-agency-watch', 'Okara', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), NULL, 'IN', 'competitor'),
  ('e2e-watchlist-agency-quiet', 'e2e-agency', 'Agency quiet proof watch', 'advertiser', 'steady.example.invalid', 'e2e-agency-quiet-watch', 'Steady Labs', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes'), NULL, 'IN', 'competitor'),
  ('e2e-watchlist-agency-unbranded-1', 'e2e-agency-unbranded', 'Agency unbranded proof watch', 'advertiser', 'okara.example.invalid', 'e2e-agency-unbranded-watch', 'Okara', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), NULL, 'IN', 'competitor'),
  ('e2e-watchlist-j3-workflow', 'e2e-starter', 'Workflow acceptance watch', 'saved_query', 'e2e-query-j3-workflow', 'e2e-query-j3-workflow', 'Workflow Fixture', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, 'IN', 'competitor'),
  ('e2e-watchlist-j3-crash', 'e2e-starter', 'Crash reclaim watch', 'saved_query', 'e2e-query-j3-crash', 'e2e-query-j3-crash', 'Crash Fixture', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, 'IN', 'competitor');

INSERT INTO ad (id, advertiser, body, body_secondary, preview_headline, preview_subhead, hook, offer_text, cta, creative_format, language_label, destination_type, landing_page_url, ad_snapshot_url, countries_json, platforms_json, first_seen_at, last_seen_at, is_active, source, research_summary, raw_json, created_at, updated_at, creative_text, creative_text_capture_method, creative_text_metadata_json) VALUES
  ('e2e-ad-1', 'Okara', 'Fixture ad body for competitor monitoring.', NULL, 'New AI workflow launch', 'Proof-backed competitor move', 'Launch proof', 'Free trial', 'Learn more', 'image', 'English', 'website', 'https://okara.example.invalid/launch', 'https://facebook.com/ads/library/?id=e2e-ad-1', '["IN"]', '["facebook","instagram"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), 1, 'meta_library_browser', 'E2E fixture ad for non-customer QA.', '{"id":"e2e-ad-1"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), 'Fixture creative text', 'manual', '{}'),
  ('e2e-ad-agency-quiet', 'Steady Labs', 'Fixture unchanged ad body for a successful quiet check.', NULL, 'Steady workflow offer', 'Proof-backed quiet competitor state', 'Steady proof', 'Book a demo', 'Learn more', 'image', 'English', 'website', 'https://steady.example.invalid/workflows', 'https://facebook.com/ads/library/?id=e2e-ad-agency-quiet', '["IN"]', '["facebook","instagram"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes'), 1, 'meta_library_browser', 'E2E quiet-state evidence for non-customer QA.', '{"id":"e2e-ad-agency-quiet"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes'), 'Fixture unchanged creative text', 'manual', '{}'),
  ('e2e-ad-external', 'Filed Rival', '', NULL, '', '', 'Team observed a landing-page offer', '20% off annual', 'Compare plans', 'landing_page', 'English', 'website', 'https://filed.example.invalid/annual', 'https://filed.example.invalid/annual', '["IN"]', '["Landing page"]', '2026-07-24T00:00:00.000Z', NULL, 0, 'external', 'Team-filed fixture for provenance capture.', '{"id":"e2e-ad-external"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), NULL, NULL, '{}'),
  ('e2e-ad-demo', 'Sample Rival', 'Clearly labelled sample evidence for non-customer QA.', NULL, 'Sample launch message', '', 'Sample competitor move', 'Sample offer', 'Learn more', 'image', 'English', 'website', 'https://sample.example.invalid/launch', NULL, '["IN"]', '["Meta"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), 0, 'demo', 'Sample-only fixture for provenance capture.', '{"id":"e2e-ad-demo"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), NULL, NULL, '{}');

INSERT INTO discovery_cache_entry (cache_key, provider, route_context, query_fingerprint, country, cursor, payload_json, fetched_at, expires_at, browser_ms_used, created_at, updated_at) VALUES
  ('search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1', 'meta_library_browser', 'public_search', 'e2e-nykaa-exact', 'all', NULL,
    json_object('ads', json_array(json_object('metaAdId','e2e-nykaa-live-1','advertiser','Nykaa','body','Fixture live-search ad for journey verification.','previewHeadline','Festive glow sale','previewSubhead','Fixture source evidence','hook','Festive glow','offer','Up to 40% off selected beauty','cta','Shop now','format','image','languageLabel','English','destinationType','website','landingPageUrl','https://nykaa.com/festive-glow','adSnapshotUrl','https://facebook.com/ads/library/?id=e2e-nykaa-live-1','countries',json_array('India'),'platforms',json_array('Instagram'),'firstSeenAt',strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'),'lastSeenAt',strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes'),'active',json('true'),'researchSummary','Fixture evidence for non-customer browser QA.','source','meta_library_browser','analysisFields',json_array())),'nextCursor',NULL,'source','meta_library_browser','provider','meta_library_browser','cacheStatus','hit','discoveryStatus','healthy','discoverySummary','Live ad checks are ready.','discoveryFailureClass',NULL),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+55 minutes'), 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')),
  ('search-v2:domain:nykaa.com:broader:meta_library_browser:all:page-1', 'meta_library_browser', 'public_search', 'e2e-nykaa-broader', 'all', NULL,
    json_object('ads', json_array(json_object('metaAdId','e2e-nykaa-live-1','advertiser','Nykaa','body','Fixture live-search ad for journey verification.','previewHeadline','Festive glow sale','previewSubhead','Fixture source evidence','hook','Festive glow','offer','Up to 40% off selected beauty','cta','Shop now','format','image','languageLabel','English','destinationType','website','landingPageUrl','https://nykaa.com/festive-glow','adSnapshotUrl','https://facebook.com/ads/library/?id=e2e-nykaa-live-1','countries',json_array('India'),'platforms',json_array('Instagram'),'firstSeenAt',strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'),'lastSeenAt',strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes'),'active',json('true'),'researchSummary','Fixture evidence for non-customer browser QA.','source','meta_library_browser','analysisFields',json_array())),'nextCursor',NULL,'source','meta_library_browser','provider','meta_library_browser','cacheStatus','hit','discoveryStatus','healthy','discoverySummary','Live ad checks are ready.','discoveryFailureClass',NULL),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+55 minutes'), 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')),
  ('search-v2:domain:fresh-empty.example:exact:meta_library_browser:all:page-1', 'meta_library_browser', 'public_search', 'e2e-fresh-empty', 'all', NULL,
    json_object('ads', json_array(),'nextCursor',NULL,'source','meta_library_browser','provider','meta_library_browser','cacheStatus','hit','discoveryStatus','healthy','discoverySummary','Live ad checks are ready.','discoveryFailureClass',NULL),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+55 minutes'), 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')),
  ('search-v2:domain:fresh-empty.example:broader:meta_library_browser:all:page-1', 'meta_library_browser', 'public_search', 'e2e-fresh-empty-broader', 'all', NULL,
    json_object('ads', json_array(),'nextCursor',NULL,'source','meta_library_browser','provider','meta_library_browser','cacheStatus','hit','discoveryStatus','healthy','discoverySummary','Live ad checks are ready.','discoveryFailureClass',NULL),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+55 minutes'), 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')),
  ('search-v2:domain:stale.example:exact:meta_library_browser:all:page-1', 'meta_library_browser', 'public_search', 'e2e-stale', 'all', NULL,
    json_object('ads', json_array(),'nextCursor',NULL,'source','meta_library_browser','provider','meta_library_browser','cacheStatus','stale','discoveryStatus','cache_only','discoverySummary','Fresh checks are delayed and no cached results are available.','discoveryFailureClass','timeout'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'));

INSERT INTO collection (id, user_id, name, description, created_at, updated_at) VALUES
  ('e2e-collection-starter-1', 'e2e-starter', 'Launch moves', 'Non-customer E2E report fixture.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'));
INSERT INTO collection_item (id, collection_id, ad_id, note, ad_snapshot_json, created_at, updated_at) VALUES
  ('e2e-collection-item-1', 'e2e-collection-starter-1', 'e2e-ad-1', 'Fixture proof item.', json_object('id', 'e2e-ad-1', 'advertiser', 'Okara', 'source', 'meta_library_browser', 'evidenceCapturedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-59 minutes')), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')),
  ('e2e-collection-item-external', 'e2e-collection-starter-1', 'e2e-ad-external', 'Filed by the team after reviewing the annual offer.', '{"id":"e2e-ad-external","advertiser":"Filed Rival","source":"external"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')),
  ('e2e-collection-item-demo', 'e2e-collection-starter-1', 'e2e-ad-demo', 'Sample-only evidence fixture.', '{"id":"e2e-ad-demo","advertiser":"Sample Rival","source":"demo"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days'));

INSERT INTO watchlist_run (id, watchlist_id, trigger_type, status, page_budget, pages_scanned, baseline_from_run_id, summary_json, started_at, finished_at, error_code, error_message, created_at, updated_at, idempotency_key, workflow_instance_id, processing_token, processing_started_at, queued_at, attempt_count, retry_after, queue_priority) VALUES
  ('e2e-run-starter-failed', 'e2e-watchlist-starter-1', 'scheduled', 'failed', 3, 0, NULL, '{"adsSeen":0,"scanStatus":"failed"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours', '+1 minute'), 'timeout', 'Fixture provider timeout; recovered on the next run.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours', '+1 minute'), 'e2e-run-starter-failed', NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours', '-1 minute'), 1, NULL, 1),
  ('e2e-run-starter-1', 'e2e-watchlist-starter-1', 'scheduled', 'succeeded', 3, 1, NULL, '{"adsSeen":1,"newAds":1,"inactiveAds":0,"scanStatus":"healthy"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour', '-2 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour', '-2 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), 'e2e-run-starter-1', NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour', '-3 minutes'), 1, NULL, 1),
  ('e2e-run-agency-1', 'e2e-watchlist-agency-1', 'scheduled', 'succeeded', 3, 1, NULL, '{"adsSeen":1,"newAds":1,"inactiveAds":0,"scanStatus":"healthy"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour', '-2 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour', '-2 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), 'e2e-run-agency-1', NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour', '-3 minutes'), 1, NULL, 1),
  ('e2e-run-agency-quiet', 'e2e-watchlist-agency-quiet', 'scheduled', 'succeeded', 3, 1, NULL, '{"adsSeen":1,"newAds":0,"inactiveAds":0,"events":0,"candidatesDetected":0,"proofsAttempted":1,"eventsConfirmed":0,"sendsTriggered":0,"scanStatus":"healthy"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-32 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-32 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes'), 'e2e-run-agency-quiet', NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-33 minutes'), 1, NULL, 1),
  ('e2e-run-agency-unbranded-1', 'e2e-watchlist-agency-unbranded-1', 'scheduled', 'succeeded', 3, 1, NULL, '{"adsSeen":1,"newAds":1,"inactiveAds":0,"scanStatus":"healthy"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour', '-2 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour', '-2 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), 'e2e-run-agency-unbranded-1', NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour', '-3 minutes'), 1, NULL, 1);

INSERT INTO proof_target (id, watchlist_id, ad_id, landing_page_url, canonical_page_identity, proof_target_identity, last_capture_attempt_at, last_successful_proof_at, last_successful_capture_id, created_at, updated_at) VALUES
  ('e2e-proof-target-starter', 'e2e-watchlist-starter-1', 'e2e-ad-1', 'https://okara.example.invalid/launch', 'okara.example.invalid/launch', 'e2e-proof-target-starter', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-59 minutes'), 'e2e-proof-capture-starter', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-59 minutes')),
  ('e2e-proof-target-agency', 'e2e-watchlist-agency-1', 'e2e-ad-1', 'https://okara.example.invalid/launch', 'okara.example.invalid/launch', 'e2e-proof-target-agency', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-59 minutes'), 'e2e-proof-capture-agency', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-59 minutes')),
  ('e2e-proof-target-agency-quiet', 'e2e-watchlist-agency-quiet', 'e2e-ad-agency-quiet', 'https://steady.example.invalid/workflows', 'steady.example.invalid/workflows', 'e2e-proof-target-agency-quiet', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-31 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes'), 'e2e-proof-capture-agency-quiet', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes')),
  ('e2e-proof-target-agency-unbranded', 'e2e-watchlist-agency-unbranded-1', 'e2e-ad-1', 'https://okara.example.invalid/launch', 'okara.example.invalid/launch', 'e2e-proof-target-agency-unbranded', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-59 minutes'), 'e2e-proof-capture-agency-unbranded', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-59 minutes'));
INSERT INTO proof_capture (id, proof_target_id, status, skip_reason, failure_code, failure_reason, screenshot_artifact_key, html_artifact_key, extracted_fields_json, field_confidence_json, extraction_warnings_json, capture_metadata_json, render_mode, device_profile, extractor_version, idempotency_key, attempted_at, succeeded_at, created_at, updated_at) VALUES
  ('e2e-proof-capture-starter-prior', 'e2e-proof-target-starter', 'succeeded', NULL, NULL, NULL, NULL, NULL, '{"headline":"Workflow offer baseline","cta":"Learn more","offer":"Free trial"}', '{}', '[]', '{"source":"e2e-fixture"}', 'mobile', 'mobile_default', 'e2e-v1', 'e2e-proof-capture-starter-prior', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-25 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-25 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')),
  ('e2e-proof-capture-starter', 'e2e-proof-target-starter', 'succeeded', NULL, NULL, NULL, NULL, NULL, '{"headline":"New AI workflow launch","cta":"Learn more","offer":"Starting at ₹499"}', '{}', '[]', '{"source":"e2e-fixture"}', 'mobile', 'mobile_default', 'e2e-v1', 'e2e-proof-capture-starter', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-59 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-59 minutes')),
  ('e2e-proof-capture-agency-prior', 'e2e-proof-target-agency', 'succeeded', NULL, NULL, NULL, NULL, NULL, '{"headline":"Workflow offer baseline","cta":"Learn more"}', '{}', '[]', '{"source":"e2e-fixture"}', 'mobile', 'mobile_default', 'e2e-v1', 'e2e-proof-capture-agency-prior', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-25 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-25 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')),
  ('e2e-proof-capture-agency', 'e2e-proof-target-agency', 'succeeded', NULL, NULL, NULL, NULL, NULL, '{"headline":"New AI workflow launch","cta":"Learn more"}', '{}', '[]', '{"source":"e2e-fixture"}', 'mobile', 'mobile_default', 'e2e-v1', 'e2e-proof-capture-agency', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-59 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-59 minutes')),
  ('e2e-proof-capture-agency-quiet-prior', 'e2e-proof-target-agency-quiet', 'succeeded', NULL, NULL, NULL, NULL, NULL, '{"headline":"Steady workflow offer","cta":"Learn more","offer":"Book a demo"}', '{}', '[]', '{"source":"e2e-fixture","state":"quiet-baseline"}', 'mobile', 'mobile_default', 'e2e-v1', 'e2e-proof-capture-agency-quiet-prior', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days', '-1 minute'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days', '-1 minute'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')),
  ('e2e-proof-capture-agency-quiet', 'e2e-proof-target-agency-quiet', 'succeeded', NULL, NULL, NULL, NULL, NULL, '{"headline":"Steady workflow offer","cta":"Learn more","offer":"Book a demo"}', '{}', '[]', '{"source":"e2e-fixture","state":"quiet-unchanged"}', 'mobile', 'mobile_default', 'e2e-v1', 'e2e-proof-capture-agency-quiet', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-31 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-31 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes')),
  ('e2e-proof-capture-agency-unbranded-prior', 'e2e-proof-target-agency-unbranded', 'succeeded', NULL, NULL, NULL, NULL, NULL, '{"headline":"Workflow offer baseline","cta":"Learn more"}', '{}', '[]', '{"source":"e2e-fixture"}', 'mobile', 'mobile_default', 'e2e-v1', 'e2e-proof-capture-agency-unbranded-prior', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-25 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-25 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')),
  ('e2e-proof-capture-agency-unbranded', 'e2e-proof-target-agency-unbranded', 'succeeded', NULL, NULL, NULL, NULL, NULL, '{"headline":"New AI workflow launch","cta":"Learn more"}', '{}', '[]', '{"source":"e2e-fixture"}', 'mobile', 'mobile_default', 'e2e-v1', 'e2e-proof-capture-agency-unbranded', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-59 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-59 minutes'));

INSERT INTO watch_event (id, watchlist_id, run_id, event_type, status, importance_score, ad_id, baseline_from_run_id, candidate_id, proof_capture_id, title, summary, metadata_json, confirmed_at, suppressed_at, invalidated_at, last_evaluated_at, created_at) VALUES
  ('e2e-event-confirmed', 'e2e-watchlist-starter-1', 'e2e-run-starter-1', 'landing_page_offer_changed', 'confirmed', 86, 'e2e-ad-1', NULL, NULL, 'e2e-proof-capture-starter', 'Landing page offer changed', 'Fixture confirmed proof-backed offer change.', '{"from":"Free trial","to":"Starting at ₹499","recommendedAction":"Review offer positioning","proofTrail":"Verified from a page snapshot"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-58 minutes'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-58 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-58 minutes')),
  ('e2e-event-ad-new-unenriched', 'e2e-watchlist-starter-1', 'e2e-run-starter-1', 'ad_new', 'confirmed', 82, 'e2e-ad-1', NULL, NULL, NULL, 'Okara launched a new workflow offer', 'Fixture unenriched ad_new without stored field diff.', '{"source":"scan_spotted","recommendedAction":"Review offer positioning"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-59 minutes'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-59 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-59 minutes')),
  ('e2e-event-agency-confirmed', 'e2e-watchlist-agency-1', 'e2e-run-agency-1', 'landing_page_offer_changed', 'confirmed', 91, 'e2e-ad-1', NULL, NULL, 'e2e-proof-capture-agency', 'Landing page offer changed', 'Agency fixture confirmed proof-backed offer change.', '{"from":"Free trial","to":"Starting at ₹499","recommendedAction":"Prepare client counter-positioning","proofTrail":"Verified from a page snapshot"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-58 minutes'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-58 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-58 minutes')),
  ('e2e-event-agency-unbranded-confirmed', 'e2e-watchlist-agency-unbranded-1', 'e2e-run-agency-unbranded-1', 'landing_page_offer_changed', 'confirmed', 91, 'e2e-ad-1', NULL, NULL, 'e2e-proof-capture-agency-unbranded', 'Landing page offer changed', 'Agency unbranded fixture confirmed proof-backed offer change.', '{"from":"Free trial","to":"Starting at ₹499","recommendedAction":"Prepare client counter-positioning","proofTrail":"Verified from a page snapshot"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-58 minutes'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-58 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-58 minutes')),
  ('e2e-event-suppressed', 'e2e-watchlist-starter-1', 'e2e-run-starter-1', 'ad_inactive', 'suppressed', 12, 'e2e-ad-1', NULL, NULL, NULL, 'Suppressed low-signal change', 'Fixture suppressed item should not dominate trust views.', '{"source":"scan_spotted"}', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-57 minutes'), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-57 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-57 minutes'));

INSERT INTO digest_run (id, user_id, period_start, period_end, summary_json, created_at) VALUES
  ('e2e-digest-starter-1', 'e2e-starter', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), '{"headline":"One important competitor move","topMoves":["Okara launched a new workflow offer"],"allQuiet":false}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes')),
  ('e2e-digest-j3-provider-denied', 'e2e-starter', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), '{"headline":"Provider-denied replay","topMoves":["Fixture delivery remains local"],"allQuiet":false}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO digest_item (id, digest_run_id, watchlist_id, watchlist_name, event_type, title, summary, metadata_json, created_at) VALUES
  ('e2e-digest-item-1', 'e2e-digest-starter-1', 'e2e-watchlist-starter-1', 'Okara competitor watch', 'landing_page_offer_changed', 'Landing page offer changed', 'Fixture confirmed proof-backed offer change.',
    json_object(
      'eventId', 'e2e-event-confirmed',
      'proofCaptureId', 'e2e-proof-capture-starter',
      'sourceStatus', 'proof_backed',
      'priorityScore', 86,
      'priorityBand', 'High priority',
      'from', 'Free trial',
      'to', 'Starting at ₹499',
      'beforeCapturedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours'),
      'confirmedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-58 minutes')
    ),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes'));
INSERT INTO digest_delivery (id, digest_run_id, provider, status, recipient_email, external_message_id, error_message, delivered_at, created_at, updated_at) VALUES
  ('e2e-digest-delivery-1', 'e2e-digest-starter-1', 'cloudflare_email', 'sent', 'e2e-starter@example.invalid', 'e2e-message-1', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-29 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-29 minutes'));
INSERT INTO delivery_attempt (id, user_id, watchlist_id, digest_run_id, delivery_target_id, lane, channel, provider, status, webhook_status, target_value, provider_message_id, provider_status_last_seen_at, template_name, event_ids_json, payload_snapshot_json, idempotency_key, error_message, sent_at, failed_at, created_at, updated_at) VALUES
  ('e2e-delivery-attempt-1', 'e2e-starter', NULL, 'e2e-digest-starter-1', NULL, 'customer', 'email', 'cloudflare_email', 'sent', 'legacy_unknown', 'e2e-starter@example.invalid', 'e2e-message-1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-29 minutes'), NULL, '["e2e-event-confirmed"]', '{"redacted":true}', 'e2e-delivery-attempt-1', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-29 minutes'), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-29 minutes'));
INSERT INTO delivery_target (id, user_id, watchlist_id, channel, target_value, validation_status, is_validated, is_opted_in, opt_in_source, opted_in_at, is_paused, paused_at, opted_out_at, template_eligible, last_successful_delivery_at, last_successful_attempt_id, provider_identifier, metadata_json, created_at, updated_at) VALUES
  ('e2e-delivery-target-email', 'e2e-starter', NULL, 'email', 'e2e-starter@example.invalid', 'validated', 1, 1, 'e2e-fixture', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), 0, NULL, NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-29 minutes'), 'e2e-delivery-attempt-1', NULL, '{}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-29 minutes'));

INSERT INTO evidence_usage_period (id, workspace_user_id, period_start, period_end, plan_family, included_allowance, included_consumed, created_at) VALUES
  ('e2e-usage-period-starter', 'e2e-starter', strftime('%Y-%m-01T00:00:00.000Z', 'now'), strftime('%Y-%m-01T00:00:00.000Z', 'now', '+1 month'), 'starter', 250, 42, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'));
INSERT INTO evidence_top_up_grant (id, workspace_user_id, sku_slug, provider_payment_id, provider_product_id, quantity_granted, quantity_remaining, granted_at, status, catalog_version, metadata_json) VALUES
  ('e2e-top-up-starter', 'e2e-starter', 'burst_500_v1', 'pay_e2e_top_up', 'product_e2e_top_up', 500, 500, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days'), 'active', 'v1', '{"fixture":true}');

INSERT INTO tracked_entity (id, user_id, tracking_mode, label, canonical_url, notes, is_active, deleted_at, created_at, updated_at) VALUES
  ('e2e-presence-self', 'e2e-starter', 'self', 'Starter Fixture Studio', 'https://starter.example.invalid', 'Fixture self presence source.', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')),
  ('e2e-presence-competitor', 'e2e-starter', 'competitor', 'Okara', 'https://okara.example.invalid', 'Fixture competitor presence source.', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'));
INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, target_url, target_handle, metadata_json, coverage_label, is_active, deleted_at, created_at, updated_at) VALUES
  ('e2e-source-self', 'e2e-presence-self', 'e2e-starter', 'website', 'starter.example.invalid', 'https://starter.example.invalid', NULL, '{"health":"ok"}', 'GOOD', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')),
  ('e2e-source-competitor', 'e2e-presence-competitor', 'e2e-starter', 'website', 'okara.example.invalid', 'https://okara.example.invalid', NULL, '{"health":"ok"}', 'GOOD', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'));
INSERT INTO presence_poll_cursor (source_target_id, cursor_json, etag, last_modified, last_polled_at, last_success_at, last_error_code, last_error_message, updated_at) VALUES
  ('e2e-source-competitor', '{}', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'));
INSERT INTO presence_item (id, source_target_id, tracked_entity_id, user_id, connector_id, external_id, canonical_url, url_hash, title, body_excerpt, author, published_at, observed_at, content_hash, raw_json, is_tombstone, created_at, revision) VALUES
  ('e2e-presence-item-1', 'e2e-source-competitor', 'e2e-presence-competitor', 'e2e-starter', 'website', 'e2e-presence-item-1', 'https://okara.example.invalid/blog/workflow-launch', 'e2e-presence-hash-1', 'Workflow launch post', 'Fixture website mention for Presence QA.', 'Okara Team', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), 'e2e-content-hash-1', '{"fixture":true}', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), 1);

INSERT INTO customer_api_key (id, user_id, name, key_prefix, key_hash, last_used_at, revoked_at, created_at, updated_at, actions_write_enabled) VALUES
  ('e2e-api-key-agency', 'e2e-agency', 'Fixture read-only key', 'f9_e2e', 'e2e_api_key_hash', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), 0);

INSERT INTO support_case (id, user_id, category, priority, status, subject, detail, context_json, created_at, updated_at, request_key) VALUES
  ('e2e-support-case-1', 'e2e-starter', 'billing', 'normal', 'open', 'Fixture billing question', 'Non-customer support fixture for E2E QA.', '{}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), 'e2e-support-case-1'),
  ('e2e-support-recovery-case', 'e2e-support-recovery', 'delivery', 'urgent', 'open', 'Fixture operator notification recovery', 'The first operator alert failed and a later retry recovered.', '{}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), 'e2e-support-recovery-case');
INSERT INTO support_case_event (id, case_id, user_id, event_type, message, visible_to_customer, metadata_json, created_at) VALUES
  ('e2e-support-event-1', 'e2e-support-case-1', 'e2e-starter', 'case_opened', 'Fixture case opened.', 1, '{}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')),
  ('e2e-support-recovery-opened', 'e2e-support-recovery-case', 'e2e-support-recovery', 'case_opened', 'Fixture recovery case opened.', 1, '{}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('e2e-support-recovery-failed', 'e2e-support-recovery-case', 'e2e-support-recovery', 'support_notification_failed', 'Operator notification failed safely.', 0, '{"fixture":true,"sanitized":true}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours', '+1 minute')),
  ('e2e-support-recovery-sent', 'e2e-support-recovery-case', 'e2e-support-recovery', 'support_notified', 'Operator notification recovered.', 0, '{"fixture":true,"sanitized":true}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'));

INSERT INTO workspace_member (id, owner_user_id, member_user_id, invited_email, role, status, token_hash, token_expires_at, created_at, accepted_at, revoked_at) VALUES
  ('e2e-member-active', 'e2e-agency', 'e2e-active-member', 'e2e-active-member@example.invalid', 'member', 'active', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-9 days'), NULL),
  ('e2e-member-revoked', 'e2e-agency', 'e2e-removed-member', 'e2e-removed-member@example.invalid', 'member', 'revoked', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-9 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'));

-- WP-C2 Gate-B first-run fixtures (self-contained; cleaned by the LIKE 'e2e-%' resets).
-- e2e-free-firstbrief: free (weekly) workspace with exactly ONE filed brief — the
-- Beat 4 front page + retirement + weekly cadence truth.
INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, onboardedAt) VALUES
  ('e2e-free-firstbrief', 'E2E Free First Brief', 'e2e-free-firstbrief@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-9 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days')),
  ('e2e-free-firstscan', 'E2E Free First Scan', 'e2e-free-firstscan@example.invalid', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'));

INSERT INTO user_plan (user_id, plan, plan_updated_at, dodo_payment_id, dodo_product_id, dodo_status, dodo_subscription_id, dodo_customer_id, dodo_next_billing_at, evidence_entitlement_anchor, evidence_entitlement_anchor_source) VALUES
  ('e2e-free-firstbrief', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e2e-free-firstscan', 'free', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, last_scanned_at, created_at, updated_at, paused_reason, target_country, tracking_role) VALUES
  ('e2e-watchlist-firstbrief', 'e2e-free-firstbrief', 'Rival Labs weekly watch', 'advertiser', 'rivallabs.example.invalid', 'e2e-firstbrief-watch', 'Rival Labs', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days'), NULL, 'US', 'competitor'),
  ('e2e-watchlist-firstscan', 'e2e-free-firstscan', 'Rival Labs first scan', 'advertiser', 'rivallabs.example.invalid', 'e2e-firstscan-watch', 'Rival Labs', 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 minutes'), NULL, 'US', 'competitor');

INSERT INTO watchlist_run (id, watchlist_id, trigger_type, status, page_budget, pages_scanned, baseline_from_run_id, summary_json, started_at, finished_at, error_code, error_message, created_at, updated_at, idempotency_key, workflow_instance_id, processing_token, processing_started_at, queued_at, attempt_count, retry_after, queue_priority) VALUES
  ('e2e-run-firstbrief', 'e2e-watchlist-firstbrief', 'scheduled', 'succeeded', 1, 1, NULL, '{"adsSeen":4,"newAds":1,"scanStatus":"healthy"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days', '-2 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days', '-2 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days'), 'e2e-run-firstbrief', NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days', '-3 minutes'), 1, NULL, 2),
  ('e2e-run-firstscan', 'e2e-watchlist-firstscan', 'manual', 'running', 1, 0, NULL, '{}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 minutes'), NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 minutes'), 'e2e-run-firstscan', NULL, 'e2e-token-firstscan', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 minutes'), 1, NULL, 2);

INSERT INTO digest_run (id, user_id, period_start, period_end, summary_json, created_at) VALUES
  ('e2e-digest-firstbrief', 'e2e-free-firstbrief', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), '{"headline":"Rival Labs is testing hard","topMoves":["Rival Labs launched a new offer"],"allQuiet":false}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'));

INSERT INTO digest_item (id, digest_run_id, watchlist_id, watchlist_name, event_type, title, summary, metadata_json, created_at) VALUES
  ('e2e-digest-item-firstbrief', 'e2e-digest-firstbrief', 'e2e-watchlist-firstbrief', 'Rival Labs', 'landing_page_offer_changed', 'Rival Labs launched a new offer', 'Fixture first-brief item with verified proof.', '{"status":"confirmed","proofStatus":"confirmed","priority":"high","proofCaptureId":"e2e-proof-firstbrief","from":"₹999 launch price","to":"₹799 launch price","beforeCapturedAt":"' || strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days') || '","confirmedAt":"' || strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day') || '"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'));

INSERT INTO digest_delivery (id, digest_run_id, provider, status, recipient_email, external_message_id, error_message, delivered_at, created_at, updated_at) VALUES
  ('e2e-digest-delivery-firstbrief', 'e2e-digest-firstbrief', 'cloudflare_email', 'sent', 'e2e-free-firstbrief@example.invalid', 'e2e-message-firstbrief', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'));

-- Issue #1284: a real landing_page_snapshot for nike.com with BOTH a stored
-- screenshot artifact and a page-text extract, so the e2e timeline render
-- check can verify the positive path (entry renders, screenshot link 200s).
-- The migration 0079 backfill row for nike.com has no artifacts and is
-- filtered out by the proof gate; this row passes the gate. The R2 objects
-- at the keys below are seeded by scripts/e2e-prepare-local.mjs.
INSERT INTO landing_page_snapshot (
  id, raw_url, canonical_url, raw_headline, normalized_headline,
  normalized_headline_hash, capture_method, artifact_key, metadata_json,
  cta_text, price_text, form_present, ocr_text, translated_text,
  captured_at, created_at
) VALUES (
  'e2e-timeline-nike-20260825',
  'https://www.nike.com/',
  'https://www.nike.com/',
  'Nike. Just Do It.',
  'nike. just do it.',
  'e2e-timeline-nike-20260825',
  'landing_page_fetch',
  'landing-pages/2026-08-25/e2e0000000000000000000000000000001.html',
  '{"screenshotArtifactKey":"landing-pages/2026-08-25/e2e0000000000000000000000000000001.png","htmlArtifactKey":"landing-pages/2026-08-25/e2e0000000000000000000000000000001.html"}',
  'Shop Now', NULL, 0, NULL, NULL,
  '2026-08-25T00:00:00.000Z', '2026-08-27T00:00:00.000Z'
);
