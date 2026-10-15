-- 0067_hide_unjudged_mentions.sql — a mention is shown only once it is judged
-- about the brand with p >= 0.5 (ABOUT_BRAND_KEEP_AT in app/lib/jev/thresholds.ts,
-- question id ABOUT_BRAND.id in app/lib/mentions/questions.ts). Insert now
-- tombstones an unjudged one and the re-judge un-hides the ones about the brand;
-- this hides what is already stored: unjudged rows (kept so the re-judge finds
-- them) and judged rows whose about-brand p is below 0.5 (the old line was
-- p > 0.1, which let unrelated Hacker News posts onto a competitor's page).
-- mention_hidden_0067 records exactly which rows this file hid, so it can be
-- undone row by row. Undo only the judged rows (the re-judge owns the unjudged ones):
-- UPDATE signal SET is_tombstoned = 0 WHERE id IN (SELECT signal_id FROM mention_hidden_0067 WHERE state IS NOT 'unjudged').

CREATE TABLE mention_hidden_0067 AS
SELECT s.id AS signal_id, s.workspace_id, s.state,
  (SELECT v.p FROM jev_verdict v
   WHERE v.signal_id = s.id AND v.question_id = 'mention_is_about_brand'
   ORDER BY v.decided_at DESC LIMIT 1) AS about_brand_p
FROM signal s
WHERE s.kind = 'mention' AND s.is_tombstoned = 0
  AND (
    s.state = 'unjudged'
    OR (
      SELECT v.p FROM jev_verdict v
      WHERE v.signal_id = s.id AND v.question_id = 'mention_is_about_brand'
      ORDER BY v.decided_at DESC LIMIT 1
    ) < 0.5
  );

UPDATE signal SET is_tombstoned = 1 WHERE id IN (SELECT signal_id FROM mention_hidden_0067);
