-- Mentions source registry. Rows only: the schema already has config_json, and
-- the contract docs do not add canary, judged, or approved_cost columns.

INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES
  ('src_news_google_rss', 'news.google_rss', 'mentions', 'google', 'news.google_rss', 'rss', 1,
   '{"rateClass":"fast","canaryUrl":"https://news.google.com/rss/search?q=%22Gymshark%22&hl=en-US&gl=US&ceid=US:en","expectNonzero":true,"approved_cost":null}'),
  ('src_reddit_search_rss', 'reddit.search_rss', 'mentions', 'reddit', 'reddit.search_rss', 'rss', 1,
   '{"rateClass":"paced","canaryUrl":"https://www.reddit.com/search.rss?q=gymshark&sort=new","expectNonzero":true,"approved_cost":null}'),
  ('src_hn_algolia', 'hn.algolia', 'mentions', 'hn', 'hn.algolia', 'official_api', 1,
   '{"rateClass":"fast","canaryUrl":"https://hn.algolia.com/api/v1/search_by_date?query=gymshark&tags=story&hitsPerPage=3","expectNonzero":true,"approved_cost":null}'),
  ('src_youtube_channel_rss', 'youtube.channel_rss', 'mentions', 'youtube', 'youtube.channel_rss', 'rss', 1,
   '{"rateClass":"fast","canaryUrl":"https://www.youtube.com/feeds/videos.xml?channel_id=UCQUjD1_ysB6Z7Q08TOWB9sg","expectNonzero":true,"approved_cost":null}'),
  ('src_medium_tag_rss', 'medium.tag_rss', 'mentions', 'medium', 'medium.tag_rss', 'rss', 1,
   '{"rateClass":"fast","canaryUrl":"https://medium.com/feed/tag/startup","expectNonzero":true,"approved_cost":null}'),
  ('src_ddg_html', 'ddg.html', 'mentions', 'duckduckgo', 'ddg.html', 'scraped_page', 0,
   '{"rateClass":"paced","canaryUrl":"https://html.duckduckgo.com/html/?q=%22gymshark%22","expectNonzero":true,"approved_cost":null,"disabledReason":"202-challenged 5/5 attempts 2026-09-21"}'),
  ('src_x_apify', 'x.apify', 'mentions', 'x', 'x.apify', 'best_effort', 0,
   '{"rateClass":"paced","canaryUrl":"","expectNonzero":true,"approved_cost":null,"quotedCost":"Apify about $0.40 per 1,000 tweets","disabledReason":"Every zero-spend X route is closed. approved_cost stays null until Nish says yes."}');
