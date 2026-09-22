-- X mentions registry row, inserted disabled.
-- Nish 2026-09-22: no paid X provider until revenue.
-- Turning it on later is an UPDATE of is_enabled on this row.
-- approved_cost stays JSON null until that decision.
-- Cheapest known route, recorded and not used: Apify, roughly $0.40 per 1,000 tweets.
-- No adapter, no credential, no call.

INSERT INTO source (
  id,
  key,
  kind,
  platform,
  plugin_key,
  reliability,
  is_enabled,
  config_json
) VALUES (
  'src_mentions_x',
  'x.apify',
  'mentions',
  'x',
  'apify',
  'best_effort',
  0,
  '{"reason":"Nish 2026-09-22: no paid X provider until revenue","decision_on":"2026-09-22","cheapest_known_route":{"provider":"Apify","usd_per_1000_tweets":0.4,"note":"roughly $0.40 per 1,000 tweets"},"approved_cost":null}'
);
