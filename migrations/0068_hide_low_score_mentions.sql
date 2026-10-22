-- 0068_hide_low_score_mentions.sql — four judged mentions (about-brand p 0.14 to 0.20)
-- were stored visible at 2026-10-15 19:08Z, after 0067 ran. A mention shows only at
-- p >= 0.5 (ABOUT_BRAND_KEEP_AT in app/lib/jev/thresholds.ts); this hides every judged
-- mention still visible whose latest about-brand verdict is below that. Unjudged rows
-- are not touched here. The rows hidden are added to mention_hidden_0067 so the undo
-- recipe in 0067 covers them.

INSERT OR IGNORE INTO mention_hidden_0067 (signal_id, state, about_brand_p)
SELECT s.id, s.state,
  (SELECT v.p FROM jev_verdict v
   WHERE v.signal_id = s.id AND v.question_id = 'mention_is_about_brand'
   ORDER BY v.decided_at DESC, v.id DESC LIMIT 1)
FROM signal s
WHERE s.kind = 'mention' AND s.is_tombstoned = 0 AND s.state = 'judged'
  AND (
    SELECT v.p FROM jev_verdict v
    WHERE v.signal_id = s.id AND v.question_id = 'mention_is_about_brand'
    ORDER BY v.decided_at DESC, v.id DESC LIMIT 1
  ) < 0.5;

UPDATE signal SET is_tombstoned = 1
WHERE kind = 'mention' AND is_tombstoned = 0 AND state = 'judged'
  AND (
    SELECT v.p FROM jev_verdict v
    WHERE v.signal_id = signal.id AND v.question_id = 'mention_is_about_brand'
    ORDER BY v.decided_at DESC, v.id DESC LIMIT 1
  ) < 0.5;
