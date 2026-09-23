-- 0007_mentions_sources.sql — the six mentions source rows (#4532, engine P5.1).
--
-- `docs/engines/mentions.md` P5.1: one source row per mention network, each with
-- kind = 'mentions', its reliability and its canary query. A new source is a row
-- plus a plugin, never a migration (#3891, #3842) — the only migration work P5.1
-- allows is this INSERT, and this file is it.
--
-- The transports and adapters are P5.1-P5.6 work under workers/; this file only
-- seeds the registry rows they will be driven by.
--
-- is_enabled = 0 is the mechanism for ddg.html, not a label. The tick's
-- eligibility predicate requires source.is_enabled = 1 (docs/engines/mentions.md
-- P5.2), so a disabled row cannot be selected, cannot become a queue message and
-- cannot produce a snapshot. It 202-challenged 5 of 5 attempts on 2026-09-21
-- (probe evidence per docs/engines/mentions.md P5.4), so its canary is expected
-- to be non-zero false and the reason is recorded in the row rather than in a
-- ticket. The other five are enabled.
--
-- Numbering: 0006 is taken by 0006_scoring_weight_seed.sql on origin/main today
-- (issue #4532's rename rule), so the next free number is 0007.

INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES
  ('src_mentions_news_google_rss',
   'news.google_rss', 'mentions', 'google_news', 'news.google_rss', 'rss', 1,
   '{"rateClass":"fast","canaryUrl":"https://news.google.com/rss/search?q=gymshark&hl=en-US&gl=US&ceid=US:en","expectNonzero":true}'),

  ('src_mentions_reddit_search_rss',
   'reddit.search_rss', 'mentions', 'reddit', 'reddit.search_rss', 'rss', 1,
   '{"rateClass":"paced","canaryUrl":"https://www.reddit.com/search.rss?q=gymshark&sort=new","expectNonzero":true}'),

  ('src_mentions_hn_algolia',
   'hn.algolia', 'mentions', 'hn', 'hn.algolia', 'official_api', 1,
   '{"rateClass":"fast","canaryUrl":"https://hn.algolia.com/api/v1/search_by_date?query=gymshark&tags=story","expectNonzero":true}'),

  ('src_mentions_youtube_channel_rss',
   'youtube.channel_rss', 'mentions', 'youtube', 'youtube.channel_rss', 'rss', 1,
   '{"rateClass":"fast","canaryUrl":"https://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw","expectNonzero":true}'),

  ('src_mentions_medium_tag_rss',
   'medium.tag_rss', 'mentions', 'medium', 'medium.tag_rss', 'rss', 1,
   '{"rateClass":"fast","canaryUrl":"https://medium.com/feed/tag/fitness","expectNonzero":true}'),

  ('src_mentions_ddg_html',
   'ddg.html', 'mentions', 'ddg', 'ddg.html', 'scraped_page', 0,
   '{"rateClass":"paced","canaryUrl":"https://html.duckduckgo.com/html/?q=gymshark","expectNonzero":false,"disabledReason":"202-challenged 5/5 attempts 2026-09-21"}');
