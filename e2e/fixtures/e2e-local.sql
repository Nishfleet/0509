PRAGMA foreign_keys = OFF;

DELETE FROM delivery_attempt WHERE user_id LIKE 'e2e-%';
DELETE FROM digest_delivery WHERE digest_run_id LIKE 'e2e-%';
DELETE FROM digest_item WHERE digest_run_id LIKE 'e2e-%';
DELETE FROM digest_run WHERE user_id LIKE 'e2e-%';
DELETE FROM watch_event WHERE id LIKE 'e2e-%';
DELETE FROM proof_capture WHERE id LIKE 'e2e-%';
DELETE FROM proof_target WHERE id LIKE 'e2e-%';
DELETE FROM watchlist_run WHERE id LIKE 'e2e-%';
DELETE FROM collection_item WHERE id LIKE 'e2e-%';
DELETE FROM ad WHERE id LIKE 'e2e-%';
DELETE FROM collection WHERE user_id LIKE 'e2e-%';
DELETE FROM watchlist WHERE user_id LIKE 'e2e-%';
DELETE FROM saved_query WHERE user_id LIKE 'e2e-%';
DELETE FROM presence_item_revision WHERE id LIKE 'e2e-%';
DELETE FROM presence_item WHERE id LIKE 'e2e-%';
DELETE FROM presence_poll_cursor WHERE source_target_id LIKE 'e2e-%';
DELETE FROM source_target WHERE user_id LIKE 'e2e-%';
DELETE FROM tracked_entity WHERE user_id LIKE 'e2e-%';
DELETE FROM delivery_target WHERE user_id LIKE 'e2e-%';
DELETE FROM workspace_delivery_config WHERE user_id LIKE 'e2e-%';
DELETE FROM workspace_branding WHERE user_id LIKE 'e2e-%';
DELETE FROM customer_api_key WHERE user_id LIKE 'e2e-%';
DELETE FROM customer_meta_connection WHERE user_id LIKE 'e2e-%';
DELETE FROM support_case_event WHERE user_id LIKE 'e2e-%';
DELETE FROM support_case WHERE user_id LIKE 'e2e-%';
DELETE FROM evidence_top_up_grant WHERE workspace_user_id LIKE 'e2e-%';
DELETE FROM evidence_usage_period WHERE workspace_user_id LIKE 'e2e-%';
DELETE FROM agent_action_audit WHERE user_id LIKE 'e2e-%';
DELETE FROM workspace_member WHERE owner_user_id LIKE 'e2e-%' OR member_user_id LIKE 'e2e-%';
DELETE FROM user_plan WHERE user_id LIKE 'e2e-%';
DELETE FROM user WHERE id LIKE 'e2e-%';
DELETE FROM discovery_cache_entry WHERE cache_key LIKE 'search-v2:domain:nykaa.com:%';

DROP TABLE IF EXISTS e2e_test_mode;
CREATE TABLE e2e_test_mode (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO e2e_test_mode (id, enabled, created_at) VALUES
  ('local-authenticated', 1, '2026-06-01T00:00:00.000Z');

PRAGMA foreign_keys = ON;

INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, onboardedAt) VALUES
  ('e2e-free', 'E2E Free', 'e2e-free@example.invalid', 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', NULL),
  ('e2e-free-onboarded', 'E2E Free Onboarded', 'e2e-free-onboarded@example.invalid', 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
  ('e2e-activation', 'E2E Activation', 'e2e-activation@example.invalid', 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', NULL),
  ('e2e-scout', 'E2E Scout', 'e2e-scout@example.invalid', 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
  ('e2e-starter', 'E2E Starter', 'e2e-starter@example.invalid', 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
  ('e2e-agency', 'E2E Agency', 'e2e-agency@example.invalid', 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
  ('e2e-downgraded', 'E2E Downgraded', 'e2e-downgraded@example.invalid', 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
  ('e2e-removed-member', 'E2E Removed Member', 'e2e-removed-member@example.invalid', 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z');

INSERT INTO user_plan (user_id, plan, plan_updated_at, dodo_status, dodo_customer_id, dodo_next_billing_at, evidence_entitlement_anchor, evidence_entitlement_anchor_source) VALUES
  ('e2e-free', 'free', '2026-06-01T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL),
  ('e2e-free-onboarded', 'free', '2026-06-01T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL),
  ('e2e-activation', 'starter', '2026-06-01T00:00:00.000Z', 'subscription.active', 'cus_e2e_activation', '2026-07-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', 'e2e'),
  ('e2e-scout', 'scout', '2026-06-01T00:00:00.000Z', 'subscription.active', 'cus_e2e_scout', '2026-07-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', 'e2e'),
  ('e2e-starter', 'starter', '2026-06-01T00:00:00.000Z', 'subscription.active', 'cus_e2e_starter', '2026-07-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', 'e2e'),
  ('e2e-agency', 'agency', '2026-06-01T00:00:00.000Z', 'subscription.active', 'cus_e2e_agency', '2026-07-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', 'e2e'),
  ('e2e-downgraded', 'scout', '2026-06-01T00:00:00.000Z', 'subscription.active', 'cus_e2e_downgraded', '2026-07-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', 'e2e'),
  ('e2e-removed-member', 'free', '2026-06-01T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL);

INSERT INTO workspace_branding (user_id, brand_name, brand_website, updated_at) VALUES
  ('e2e-starter', 'Starter Fixture Studio', 'https://starter.example.invalid', '2026-06-01T00:00:00.000Z'),
  ('e2e-agency', 'Agency Fixture Studio', 'https://agency.example.invalid', '2026-06-01T00:00:00.000Z');

INSERT INTO workspace_delivery_config (id, user_id, sensitivity_mode, instant_enabled, digest_enabled, email_enabled, whatsapp_enabled, quiet_hours_json, timezone, created_at, updated_at, slack_enabled) VALUES
  ('e2e-delivery-config-starter', 'e2e-starter', 'balanced', 1, 1, 1, 0, '{"start":"22:00","end":"08:00"}', 'Asia/Kolkata', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', 0);

INSERT INTO saved_query (id, user_id, name, mode, query_text, normalized_query_json, fingerprint, run_count, last_run_at, created_at, updated_at) VALUES
  ('e2e-query-starter-1', 'e2e-starter', 'Okara India ads', 'advertiser', 'okara.ai', '{"mode":"advertiser","filters":{"query":"okara.ai","country":"IN","platform":"all","creativeType":"all","status":"active","firstSeenFrom":"","lastSeenFrom":""}}', 'e2e-query-starter-1', 3, '2026-06-26T00:00:00.000Z', '2026-06-01T00:00:00.000Z', '2026-06-26T00:00:00.000Z');

INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, last_scanned_at, created_at, updated_at, paused_reason, target_country, tracking_role) VALUES
  ('e2e-watchlist-starter-1', 'e2e-starter', 'Okara competitor watch', 'saved_query', 'e2e-query-starter-1', 'e2e-query-starter-1', 'Okara', 1, '2026-06-26T08:00:00.000Z', '2026-06-01T00:00:00.000Z', '2026-06-26T08:00:00.000Z', NULL, 'IN', 'competitor'),
  ('e2e-watchlist-scout-1', 'e2e-scout', 'Scout weekly watch', 'advertiser', 'scout.example.invalid', 'e2e-scout-watch', 'Scout Fixture', 1, '2026-06-24T08:00:00.000Z', '2026-06-01T00:00:00.000Z', '2026-06-24T08:00:00.000Z', NULL, 'IN', 'competitor'),
  ('e2e-watchlist-agency-1', 'e2e-agency', 'Agency client proof watch', 'advertiser', 'okara.example.invalid', 'e2e-agency-watch', 'Okara', 1, '2026-06-26T08:00:00.000Z', '2026-06-01T00:00:00.000Z', '2026-06-26T08:00:00.000Z', NULL, 'IN', 'competitor');

INSERT INTO ad (id, advertiser, body, body_secondary, preview_headline, preview_subhead, hook, offer_text, cta, creative_format, language_label, destination_type, landing_page_url, ad_snapshot_url, countries_json, platforms_json, first_seen_at, last_seen_at, is_active, source, research_summary, raw_json, created_at, updated_at, creative_text, creative_text_capture_method, creative_text_metadata_json) VALUES
  ('e2e-ad-1', 'Okara', 'Fixture ad body for competitor monitoring.', NULL, 'New AI workflow launch', 'Proof-backed competitor move', 'Launch proof', 'Free trial', 'Learn more', 'image', 'English', 'website', 'https://okara.example.invalid/launch', 'https://facebook.com/ads/library/?id=e2e-ad-1', '["IN"]', '["facebook","instagram"]', '2026-06-20T00:00:00.000Z', '2026-06-26T00:00:00.000Z', 1, 'meta_library_browser', 'E2E fixture ad for non-customer QA.', '{"id":"e2e-ad-1"}', '2026-06-20T00:00:00.000Z', '2026-06-26T00:00:00.000Z', 'Fixture creative text', 'manual', '{}');

INSERT INTO discovery_cache_entry (cache_key, provider, route_context, query_fingerprint, country, cursor, payload_json, fetched_at, expires_at, browser_ms_used, created_at, updated_at) VALUES
  ('search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1', 'meta_library_browser', 'public_search', 'e2e-nykaa-exact', 'all', NULL, '{"ads":[{"metaAdId":"e2e-nykaa-live-1","advertiser":"Nykaa","body":"Fixture live-search ad for journey verification.","previewHeadline":"Nykaa summer beauty event","previewSubhead":"Fixture source evidence","hook":"Summer beauty event","offer":"Up to 40% off selected beauty","cta":"Shop now","format":"image","languageLabel":"English","destinationType":"website","landingPageUrl":"https://nykaa.com/summer-event","adSnapshotUrl":"https://facebook.com/ads/library/?id=e2e-nykaa-live-1","countries":["India"],"platforms":["Instagram"],"firstSeenAt":"2026-07-10T00:00:00.000Z","lastSeenAt":"2026-07-14T00:00:00.000Z","active":true,"researchSummary":"Fixture evidence for non-customer browser QA.","source":"meta_library_browser","analysisFields":[]}],"nextCursor":null,"source":"meta_library_browser","provider":"meta_library_browser","cacheStatus":"miss","discoveryStatus":"healthy","discoverySummary":null,"discoveryFailureClass":null}', '2026-07-14T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 5, '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z'),
  ('search-v2:domain:nykaa.com:broader:meta_library_browser:all:page-1', 'meta_library_browser', 'public_search', 'e2e-nykaa-broader', 'all', NULL, '{"ads":[{"metaAdId":"e2e-nykaa-live-1","advertiser":"Nykaa","body":"Fixture live-search ad for journey verification.","previewHeadline":"Nykaa summer beauty event","previewSubhead":"Fixture source evidence","hook":"Summer beauty event","offer":"Up to 40% off selected beauty","cta":"Shop now","format":"image","languageLabel":"English","destinationType":"website","landingPageUrl":"https://nykaa.com/summer-event","adSnapshotUrl":"https://facebook.com/ads/library/?id=e2e-nykaa-live-1","countries":["India"],"platforms":["Instagram"],"firstSeenAt":"2026-07-10T00:00:00.000Z","lastSeenAt":"2026-07-14T00:00:00.000Z","active":true,"researchSummary":"Fixture evidence for non-customer browser QA.","source":"meta_library_browser","analysisFields":[]}],"nextCursor":null,"source":"meta_library_browser","provider":"meta_library_browser","cacheStatus":"miss","discoveryStatus":"healthy","discoverySummary":null,"discoveryFailureClass":null}', '2026-07-14T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 5, '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z');

INSERT INTO collection (id, user_id, name, description, created_at, updated_at) VALUES
  ('e2e-collection-starter-1', 'e2e-starter', 'Launch moves', 'Non-customer E2E report fixture.', '2026-06-01T00:00:00.000Z', '2026-06-26T00:00:00.000Z');

INSERT INTO collection_item (id, collection_id, ad_id, note, ad_snapshot_json, created_at, updated_at) VALUES
  ('e2e-collection-item-1', 'e2e-collection-starter-1', 'e2e-ad-1', 'Fixture proof item.', '{"id":"e2e-ad-1","advertiser":"Okara"}', '2026-06-26T00:00:00.000Z', '2026-06-26T00:00:00.000Z');

INSERT INTO watchlist_run (id, watchlist_id, trigger_type, status, page_budget, pages_scanned, baseline_from_run_id, summary_json, started_at, finished_at, error_code, error_message, created_at, updated_at, idempotency_key, workflow_instance_id, processing_token, processing_started_at, queued_at, attempt_count, retry_after, queue_priority) VALUES
  ('e2e-run-starter-1', 'e2e-watchlist-starter-1', 'scheduled', 'succeeded', 3, 1, NULL, '{"newAds":1,"inactiveAds":0}', '2026-06-26T08:00:00.000Z', '2026-06-26T08:02:00.000Z', NULL, NULL, '2026-06-26T08:00:00.000Z', '2026-06-26T08:02:00.000Z', 'e2e-run-starter-1', NULL, NULL, NULL, '2026-06-26T07:59:00.000Z', 1, NULL, 1);

INSERT INTO watchlist_run (id, watchlist_id, trigger_type, status, page_budget, pages_scanned, baseline_from_run_id, summary_json, started_at, finished_at, error_code, error_message, created_at, updated_at, idempotency_key, workflow_instance_id, processing_token, processing_started_at, queued_at, attempt_count, retry_after, queue_priority) VALUES
  ('e2e-run-agency-1', 'e2e-watchlist-agency-1', 'scheduled', 'succeeded', 3, 1, NULL, '{"newAds":1,"inactiveAds":0}', '2026-06-26T08:00:00.000Z', '2026-06-26T08:02:00.000Z', NULL, NULL, '2026-06-26T08:00:00.000Z', '2026-06-26T08:02:00.000Z', 'e2e-run-agency-1', NULL, NULL, NULL, '2026-06-26T07:59:00.000Z', 1, NULL, 1);

INSERT INTO proof_target (id, watchlist_id, ad_id, landing_page_url, canonical_page_identity, proof_target_identity, last_capture_attempt_at, last_successful_proof_at, last_successful_capture_id, created_at, updated_at) VALUES
  ('e2e-proof-target-1', 'e2e-watchlist-starter-1', 'e2e-ad-1', 'https://okara.example.invalid/launch', 'okara.example.invalid/launch', 'e2e-proof-target-1', '2026-06-26T08:01:00.000Z', '2026-06-26T08:01:30.000Z', 'e2e-proof-capture-1', '2026-06-26T08:00:00.000Z', '2026-06-26T08:01:30.000Z');

INSERT INTO proof_capture (id, proof_target_id, status, skip_reason, failure_code, failure_reason, screenshot_artifact_key, html_artifact_key, extracted_fields_json, field_confidence_json, extraction_warnings_json, capture_metadata_json, render_mode, device_profile, extractor_version, idempotency_key, attempted_at, succeeded_at, created_at, updated_at) VALUES
  ('e2e-proof-capture-1', 'e2e-proof-target-1', 'succeeded', NULL, NULL, NULL, NULL, NULL, '{"headline":"New AI workflow launch","cta":"Learn more"}', '{}', '[]', '{"source":"e2e-fixture"}', 'mobile', 'mobile_default', 'e2e-v1', 'e2e-proof-capture-1', '2026-06-26T08:01:00.000Z', '2026-06-26T08:01:30.000Z', '2026-06-26T08:01:00.000Z', '2026-06-26T08:01:30.000Z');

INSERT INTO watch_event (id, watchlist_id, run_id, event_type, status, importance_score, ad_id, baseline_from_run_id, candidate_id, proof_capture_id, title, summary, metadata_json, confirmed_at, suppressed_at, invalidated_at, last_evaluated_at, created_at) VALUES
  ('e2e-event-confirmed', 'e2e-watchlist-starter-1', 'e2e-run-starter-1', 'ad_new', 'confirmed', 86, 'e2e-ad-1', NULL, NULL, 'e2e-proof-capture-1', 'Okara launched a new workflow offer', 'Fixture confirmed proof-backed event.', '{"source":"verified_proof","recommendedAction":"Review offer positioning","proofTrail":"Cloudflare Browser proof captured"}', '2026-06-26T08:02:00.000Z', NULL, NULL, '2026-06-26T08:02:00.000Z', '2026-06-26T08:02:00.000Z'),
  ('e2e-event-agency-confirmed', 'e2e-watchlist-agency-1', 'e2e-run-agency-1', 'ad_new', 'confirmed', 91, 'e2e-ad-1', NULL, NULL, 'e2e-proof-capture-1', 'Okara launched a new workflow offer', 'Agency fixture confirmed proof-backed event.', '{"source":"verified_proof","recommendedAction":"Prepare client counter-positioning","proofTrail":"Cloudflare Browser proof captured"}', '2026-06-26T08:02:00.000Z', NULL, NULL, '2026-06-26T08:02:00.000Z', '2026-06-26T08:02:00.000Z'),
  ('e2e-event-suppressed', 'e2e-watchlist-starter-1', 'e2e-run-starter-1', 'ad_inactive', 'suppressed', 12, 'e2e-ad-1', NULL, NULL, NULL, 'Suppressed low-signal change', 'Fixture suppressed item should not dominate trust views.', '{"source":"scan_spotted"}', NULL, '2026-06-26T08:03:00.000Z', NULL, '2026-06-26T08:03:00.000Z', '2026-06-26T08:03:00.000Z');

INSERT INTO digest_run (id, user_id, period_start, period_end, summary_json, created_at) VALUES
  ('e2e-digest-starter-1', 'e2e-starter', '2026-06-20T00:00:00.000Z', '2026-06-27T00:00:00.000Z', '{"headline":"One important competitor move","topMoves":["Okara launched a new workflow offer"],"allQuiet":false}', '2026-06-27T00:05:00.000Z');

INSERT INTO digest_item (id, digest_run_id, watchlist_id, watchlist_name, event_type, title, summary, metadata_json, created_at) VALUES
  ('e2e-digest-item-1', 'e2e-digest-starter-1', 'e2e-watchlist-starter-1', 'Okara competitor watch', 'ad_new', 'Okara launched a new workflow offer', 'Fixture digest item with verified proof.', '{"eventId":"e2e-event-confirmed","proofStatus":"confirmed","priority":"high"}', '2026-06-27T00:05:00.000Z');

INSERT INTO digest_delivery (id, digest_run_id, provider, status, recipient_email, external_message_id, error_message, delivered_at, created_at, updated_at) VALUES
  ('e2e-digest-delivery-1', 'e2e-digest-starter-1', 'cloudflare_email', 'sent', 'e2e-starter@example.invalid', 'e2e-message-1', NULL, '2026-06-27T00:06:00.000Z', '2026-06-27T00:05:00.000Z', '2026-06-27T00:06:00.000Z');

INSERT INTO delivery_attempt (id, user_id, watchlist_id, digest_run_id, delivery_target_id, lane, channel, provider, status, webhook_status, target_value, provider_message_id, provider_status_last_seen_at, template_name, event_ids_json, payload_snapshot_json, idempotency_key, error_message, sent_at, failed_at, created_at, updated_at) VALUES
  ('e2e-delivery-attempt-1', 'e2e-starter', NULL, 'e2e-digest-starter-1', NULL, 'customer', 'email', 'cloudflare_email', 'sent', 'legacy_unknown', 'e2e-starter@example.invalid', 'e2e-message-1', '2026-06-27T00:06:00.000Z', NULL, '["e2e-event-confirmed"]', '{"redacted":true}', 'e2e-delivery-attempt-1', NULL, '2026-06-27T00:06:00.000Z', NULL, '2026-06-27T00:05:00.000Z', '2026-06-27T00:06:00.000Z');

INSERT INTO delivery_target (id, user_id, watchlist_id, channel, target_value, validation_status, is_validated, is_opted_in, opt_in_source, opted_in_at, is_paused, paused_at, opted_out_at, template_eligible, last_successful_delivery_at, last_successful_attempt_id, provider_identifier, metadata_json, created_at, updated_at) VALUES
  ('e2e-delivery-target-email', 'e2e-starter', NULL, 'email', 'e2e-starter@example.invalid', 'validated', 1, 1, 'e2e-fixture', '2026-06-01T00:00:00.000Z', 0, NULL, NULL, 1, '2026-06-27T00:06:00.000Z', 'e2e-delivery-attempt-1', NULL, '{}', '2026-06-01T00:00:00.000Z', '2026-06-27T00:06:00.000Z');

INSERT INTO evidence_usage_period (id, workspace_user_id, period_start, period_end, plan_family, included_allowance, included_consumed, created_at) VALUES
  ('e2e-usage-period-starter', 'e2e-starter', '2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 'starter', 250, 42, '2026-06-01T00:00:00.000Z');

INSERT INTO evidence_top_up_grant (id, workspace_user_id, sku_slug, provider_payment_id, provider_product_id, quantity_granted, quantity_remaining, granted_at, status, catalog_version, metadata_json) VALUES
  ('e2e-top-up-starter', 'e2e-starter', 'proof_pack_500', 'pay_e2e_top_up', 'product_e2e_top_up', 500, 500, '2026-06-15T00:00:00.000Z', 'active', 'e2e', '{}');

INSERT INTO tracked_entity (id, user_id, tracking_mode, label, canonical_url, notes, is_active, deleted_at, created_at, updated_at) VALUES
  ('e2e-presence-self', 'e2e-starter', 'self', 'Starter Fixture Studio', 'https://starter.example.invalid', 'Fixture self presence source.', 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-26T00:00:00.000Z'),
  ('e2e-presence-competitor', 'e2e-starter', 'competitor', 'Okara', 'https://okara.example.invalid', 'Fixture competitor presence source.', 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-26T00:00:00.000Z');

INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, target_url, target_handle, metadata_json, coverage_label, is_active, deleted_at, created_at, updated_at) VALUES
  ('e2e-source-self', 'e2e-presence-self', 'e2e-starter', 'website', 'starter.example.invalid', 'https://starter.example.invalid', NULL, '{"health":"ok"}', 'GOOD', 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-26T00:00:00.000Z'),
  ('e2e-source-competitor', 'e2e-presence-competitor', 'e2e-starter', 'website', 'okara.example.invalid', 'https://okara.example.invalid', NULL, '{"health":"ok"}', 'GOOD', 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-26T00:00:00.000Z');

INSERT INTO presence_poll_cursor (source_target_id, cursor_json, etag, last_modified, last_polled_at, last_success_at, last_error_code, last_error_message, updated_at) VALUES
  ('e2e-source-competitor', '{}', NULL, NULL, '2026-06-26T09:00:00.000Z', '2026-06-26T09:00:00.000Z', NULL, NULL, '2026-06-26T09:00:00.000Z');

INSERT INTO presence_item (id, source_target_id, tracked_entity_id, user_id, connector_id, external_id, canonical_url, url_hash, title, body_excerpt, author, published_at, observed_at, content_hash, raw_json, is_tombstone, created_at, revision) VALUES
  ('e2e-presence-item-1', 'e2e-source-competitor', 'e2e-presence-competitor', 'e2e-starter', 'website', 'e2e-presence-item-1', 'https://okara.example.invalid/blog/workflow-launch', 'e2e-presence-hash-1', 'Workflow launch post', 'Fixture website mention for Presence QA.', 'Okara Team', '2026-06-25T00:00:00.000Z', '2026-06-26T09:00:00.000Z', 'e2e-content-hash-1', '{"fixture":true}', 0, '2026-06-26T09:00:00.000Z', 1);

INSERT INTO customer_api_key (id, user_id, name, key_prefix, key_hash, last_used_at, revoked_at, created_at, updated_at, actions_write_enabled) VALUES
  ('e2e-api-key-agency', 'e2e-agency', 'Fixture read-only key', 'f9_e2e', 'e2e_api_key_hash', '2026-06-26T00:00:00.000Z', NULL, '2026-06-01T00:00:00.000Z', '2026-06-26T00:00:00.000Z', 0);

INSERT INTO support_case (id, user_id, category, priority, status, subject, detail, context_json, created_at, updated_at, request_key) VALUES
  ('e2e-support-case-1', 'e2e-starter', 'billing', 'normal', 'open', 'Fixture billing question', 'Non-customer support fixture for E2E QA.', '{}', '2026-06-26T00:00:00.000Z', '2026-06-26T00:00:00.000Z', 'e2e-support-case-1');

INSERT INTO support_case_event (id, case_id, user_id, event_type, message, visible_to_customer, metadata_json, created_at) VALUES
  ('e2e-support-event-1', 'e2e-support-case-1', 'e2e-starter', 'case_opened', 'Fixture case opened.', 1, '{}', '2026-06-26T00:00:00.000Z');

INSERT INTO workspace_member (id, owner_user_id, member_user_id, invited_email, role, status, token_hash, token_expires_at, created_at, accepted_at, revoked_at) VALUES
  ('e2e-member-revoked', 'e2e-agency', 'e2e-removed-member', 'e2e-removed-member@example.invalid', 'member', 'revoked', NULL, NULL, '2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z', '2026-06-10T00:00:00.000Z');
