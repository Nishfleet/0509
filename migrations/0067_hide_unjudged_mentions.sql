-- 0067_hide_unjudged_mentions.sql — a mention is shown only once it is judged
-- about the brand with p >= 0.5 (ABOUT_BRAND_KEEP_AT). Insert now tombstones an
-- unjudged one and the re-judge un-hides the ones that are about the brand;
-- this hides the unjudged rows already stored (kept, so the re-judge finds
-- them) and the judged ones whose about-brand p is below 0.5 (the old line was
-- p > 0.1, which let "Flock: A Flock of Birds in your Browser" onto a
-- competitor's page).
UPDATE signal SET is_tombstoned = 1
WHERE kind = 'mention' AND is_tombstoned = 0
  AND (
    state = 'unjudged'
    OR (
      SELECT v.p FROM jev_verdict v
      WHERE v.signal_id = signal.id AND v.question_id = 'mention_is_about_brand'
      ORDER BY v.decided_at DESC LIMIT 1
    ) < 0.5
  );
