-- Mentions source registry (0509#4322, P5.1). Rows only.
--
-- The source table already has config_json. This file adds no columns.
-- X is P5.6 and ships in its own file; it is not inserted here.
--
-- Canary URLs are the probes in docs/engines/mentions.md §0–§1 and
-- docs/REBUILD-MENTIONS.md §4 and §6. YouTube uses the Gymshark channel id
-- UCma7hhYJ3bfEhZgw3xl77ww (the earlier id 404'd). Medium is the gymshark
-- tag feed that returned the guid https://medium.com/p/bd5a0a82d407.
-- rateClass follows the two queues in docs/engines/mentions.md §4:
-- Reddit and scraped_page are paced; the rest are fast.
-- ddg.html stays disabled: 202-challenged 5/5 attempts 2026-09-21.

INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES
  ('src_news_google_rss',
   'news.google_rss', 'mentions', 'google', 'news.google_rss', 'rss', 1,
   '{"rateClass":"fast","canaryUrl":"https://news.google.com/rss/search?q=%22Gymshark%22&hl=en-US&gl=US&ceid=US:en","expectNonzero":true}'),

  ('src_reddit_search_rss',
   'reddit.search_rss', 'mentions', 'reddit', 'reddit.search_rss', 'rss', 1,
   '{"rateClass":"paced","canaryUrl":"https://www.reddit.com/search.rss?q=gymshark&sort=new","expectNonzero":true}'),

  ('src_hn_algolia',
   'hn.algolia', 'mentions', 'hn', 'hn.algolia', 'official_api', 1,
   '{"rateClass":"fast","canaryUrl":"https://hn.algolia.com/api/v1/search_by_date?query=gymshark&tags=story&hitsPerPage=3","expectNonzero":true}'),

  ('src_youtube_channel_rss',
   'youtube.channel_rss', 'mentions', 'youtube', 'youtube.channel_rss', 'rss', 1,
   '{"rateClass":"fast","canaryUrl":"https://www.youtube.com/feeds/videos.xml?channel_id=UCma7hhYJ3bfEhZgw3xl77ww","expectNonzero":true}'),

  ('src_medium_tag_rss',
   'medium.tag_rss', 'mentions', 'medium', 'medium.tag_rss', 'rss', 1,
   '{"rateClass":"fast","canaryUrl":"https://medium.com/feed/tag/gymshark","expectNonzero":true}'),

  ('src_ddg_html',
   'ddg.html', 'mentions', 'duckduckgo', 'ddg.html', 'scraped_page', 0,
   '{"rateClass":"paced","canaryUrl":"https://html.duckduckgo.com/html/?q=%22gymshark%22","expectNonzero":true,"disabledReason":"202-challenged 5/5 attempts 2026-09-21"}');
