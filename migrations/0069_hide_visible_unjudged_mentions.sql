-- 0069_hide_visible_unjudged_mentions.sql — a mention shows only once it is judged
-- about the brand (see 0067). 38 gdelt.doc mentions stored by the mentions sweep
-- that ran 2026-10-15 19:00 to 21:45Z, across the deploy that carried 0067's code,
-- were stored visible and unjudged. This hides every mention still visible and
-- unjudged, and records them in mention_hidden_0067 so its undo recipe covers them.
-- The re-judge un-hides the ones it judges about the brand.

INSERT OR IGNORE INTO mention_hidden_0067 (signal_id, state, about_brand_p)
SELECT s.id, s.state,
  (SELECT v.p FROM jev_verdict v
   WHERE v.signal_id = s.id AND v.question_id = 'mention_is_about_brand'
   ORDER BY v.decided_at DESC, v.id DESC LIMIT 1)
FROM signal s
WHERE s.kind = 'mention' AND s.is_tombstoned = 0 AND s.state = 'unjudged';

UPDATE signal SET is_tombstoned = 1
WHERE kind = 'mention' AND is_tombstoned = 0 AND state = 'unjudged';
