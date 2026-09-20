WITH bounds AS (
  SELECT
    datetime('now') AS end_at,
    datetime('now', '-1 day') AS recent_24h,
    datetime('now', '-2 day') AS previous_24h,
    datetime('now', '-7 day') AS recent_7d,
    datetime('now', '-14 day') AS previous_7d
),
synthetic_user AS (
  SELECT id FROM user
  WHERE lower(trim(email)) = 'billing-canary@0509.internal' OR lower(trim(id)) = 'billing-canary-0509' OR substr(lower(trim(email)), 1, 9) = 'codex-qa-' OR substr(lower(trim(email)), 1, 14) = 'codex-free-qa-' OR substr(lower(trim(email)), 1, 7) = 'auth-qa' OR lower(trim(id)) = 'launch-readiness-canary-owner' OR substr(lower(trim(email)), -14) = '@0509.internal' OR substr(lower(trim(email)), 1, 10) = 'bet1-3322-'
),
organic_watchlist AS (
  SELECT id FROM watchlist
  WHERE id NOT IN ('launch-readiness-canary-watchlist')
    AND user_id NOT IN (SELECT id FROM synthetic_user)
)
SELECT
  (SELECT COUNT(*) FROM user WHERE id NOT IN (SELECT id FROM synthetic_user)) AS users_total,
  (SELECT COUNT(*) FROM user WHERE id NOT IN (SELECT id FROM synthetic_user) AND datetime(createdAt) >= (SELECT recent_24h FROM bounds) AND datetime(createdAt) < (SELECT end_at FROM bounds)) AS users_24h,
  (SELECT COUNT(*) FROM user WHERE id NOT IN (SELECT id FROM synthetic_user) AND datetime(createdAt) >= (SELECT previous_24h FROM bounds) AND datetime(createdAt) < (SELECT recent_24h FROM bounds)) AS users_previous_24h,
  (SELECT COUNT(*) FROM user WHERE id NOT IN (SELECT id FROM synthetic_user) AND datetime(createdAt) >= (SELECT recent_7d FROM bounds) AND datetime(createdAt) < (SELECT end_at FROM bounds)) AS users_7d,
  (SELECT COUNT(*) FROM user WHERE id NOT IN (SELECT id FROM synthetic_user) AND datetime(createdAt) >= (SELECT previous_7d FROM bounds) AND datetime(createdAt) < (SELECT recent_7d FROM bounds)) AS users_previous_7d,
  (SELECT COUNT(*) FROM user WHERE id IN (SELECT id FROM synthetic_user)) AS synthetic_users_total,
  (SELECT COUNT(*) FROM user WHERE id IN (SELECT id FROM synthetic_user) AND datetime(createdAt) >= (SELECT recent_24h FROM bounds) AND datetime(createdAt) < (SELECT end_at FROM bounds)) AS synthetic_users_24h,
  (SELECT COUNT(*) FROM user WHERE id IN (SELECT id FROM synthetic_user) AND datetime(createdAt) >= (SELECT recent_7d FROM bounds) AND datetime(createdAt) < (SELECT end_at FROM bounds)) AS synthetic_users_7d,
  (SELECT COUNT(*) FROM watchlist WHERE is_active = 1 AND id IN (SELECT id FROM organic_watchlist)) AS active_watchlists,
  (SELECT COUNT(*) FROM watchlist WHERE id IN (SELECT id FROM organic_watchlist) AND datetime(created_at) >= (SELECT recent_7d FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds)) AS watchlists_7d,
  (SELECT COUNT(*) FROM watchlist WHERE id IN (SELECT id FROM organic_watchlist) AND datetime(created_at) >= (SELECT previous_7d FROM bounds) AND datetime(created_at) < (SELECT recent_7d FROM bounds)) AS watchlists_previous_7d,
  (SELECT COUNT(*) FROM watchlist WHERE is_active = 1 AND id NOT IN (SELECT id FROM organic_watchlist)) AS synthetic_active_watchlists,
  (SELECT COUNT(*) FROM watchlist WHERE id NOT IN (SELECT id FROM organic_watchlist) AND datetime(created_at) >= (SELECT recent_7d FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds)) AS synthetic_watchlists_7d,
  (SELECT COUNT(*) FROM watchlist_run WHERE watchlist_id IN (SELECT id FROM organic_watchlist) AND datetime(created_at) >= (SELECT recent_24h FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds)) AS runs_24h,
  (SELECT COUNT(*) FROM watchlist_run WHERE watchlist_id IN (SELECT id FROM organic_watchlist) AND datetime(created_at) >= (SELECT previous_24h FROM bounds) AND datetime(created_at) < (SELECT recent_24h FROM bounds)) AS runs_previous_24h,
  (SELECT COUNT(*) FROM watchlist_run WHERE watchlist_id IN (SELECT id FROM organic_watchlist) AND datetime(created_at) >= (SELECT recent_24h FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds) AND status = 'failed') AS failed_runs_24h,
  (SELECT COUNT(*) FROM watch_event WHERE watchlist_id IN (SELECT id FROM organic_watchlist) AND datetime(created_at) >= (SELECT recent_24h FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds)) AS events_24h,
  (SELECT COUNT(*) FROM watch_event WHERE watchlist_id IN (SELECT id FROM organic_watchlist) AND datetime(created_at) >= (SELECT previous_24h FROM bounds) AND datetime(created_at) < (SELECT recent_24h FROM bounds)) AS events_previous_24h,
  (SELECT COUNT(*) FROM digest_delivery WHERE digest_run_id IN (SELECT id FROM digest_run WHERE user_id NOT IN (SELECT id FROM synthetic_user)) AND datetime(created_at) >= (SELECT recent_24h FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds) AND status = 'sent') AS digests_sent_24h,
  (SELECT COUNT(*) FROM digest_delivery WHERE digest_run_id IN (SELECT id FROM digest_run WHERE user_id NOT IN (SELECT id FROM synthetic_user)) AND datetime(created_at) >= (SELECT recent_24h FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds) AND status = 'failed') AS digests_failed_24h,
  (SELECT COUNT(*) FROM support_case WHERE status = 'open' AND user_id NOT IN (SELECT id FROM synthetic_user)) AS support_open,
  (SELECT COUNT(*) FROM support_case WHERE user_id NOT IN (SELECT id FROM synthetic_user) AND datetime(created_at) >= (SELECT recent_7d FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds)) AS support_7d,
  (SELECT COUNT(*) FROM support_case WHERE user_id NOT IN (SELECT id FROM synthetic_user) AND datetime(created_at) >= (SELECT previous_7d FROM bounds) AND datetime(created_at) < (SELECT recent_7d FROM bounds)) AS support_previous_7d,
  (SELECT COUNT(*) FROM dodo_webhook_event WHERE datetime(received_at) >= (SELECT recent_24h FROM bounds) AND datetime(received_at) < (SELECT end_at FROM bounds)) AS billing_events_24h,
  (SELECT COUNT(*) FROM dodo_webhook_event WHERE (user_id IS NULL OR user_id NOT IN (SELECT id FROM synthetic_user)) AND datetime(received_at) >= (SELECT recent_24h FROM bounds) AND datetime(received_at) < (SELECT end_at FROM bounds) AND outcome NOT IN ('processed', 'success', 'received') AND event_type NOT LIKE 'billing.canary.%') AS billing_problem_events_24h,
  (SELECT COUNT(*) FROM user_plan WHERE plan != 'free' AND COALESCE(dodo_status, '') IN ('active', 'on_hold', 'trialing') AND user_id NOT IN (SELECT id FROM synthetic_user)) AS paid_accounts,
  COALESCE((SELECT json_group_object(plan, total) FROM (SELECT plan, COUNT(*) AS total FROM user_plan WHERE user_id NOT IN (SELECT id FROM synthetic_user) GROUP BY plan)), '{}') AS plan_mix_json,
  COALESCE((SELECT json_group_object(category, total) FROM (SELECT category, COUNT(*) AS total FROM support_case WHERE user_id NOT IN (SELECT id FROM synthetic_user) AND datetime(created_at) >= (SELECT recent_7d FROM bounds) AND datetime(created_at) < (SELECT end_at FROM bounds) GROUP BY category)), '{}') AS support_categories_json,
  COALESCE((SELECT json_group_object(event_type, total) FROM (SELECT event_type, COUNT(*) AS total FROM dodo_webhook_event WHERE datetime(received_at) >= (SELECT recent_7d FROM bounds) AND datetime(received_at) < (SELECT end_at FROM bounds) GROUP BY event_type)), '{}') AS billing_event_types_json;
