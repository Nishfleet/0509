-- 0069_mention_hide_trigger.sql — the database itself hides a mention the moment
-- its about-brand verdict is below 0.5 (ABOUT_BRAND_KEEP_AT in app/lib/jev/thresholds.ts),
-- whether the verdict is stored with the row or linked to it afterwards. 0067 hid what
-- was stored then; four rows judged at p 0.14 to 0.20 were stored after it (2026-10-15
-- 19:08Z). This file hides those and any other since, and records them in
-- mention_hidden_0067 so the same undo query covers them.

INSERT OR IGNORE INTO mention_hidden_0067 (signal_id, state, about_brand_p)
SELECT s.id, s.state,
  (SELECT v.p FROM jev_verdict v
   WHERE v.signal_id = s.id AND v.question_id = 'mention_is_about_brand'
   ORDER BY v.decided_at DESC LIMIT 1)
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

UPDATE signal SET is_tombstoned = 1
WHERE id IN (SELECT signal_id FROM mention_hidden_0067) AND is_tombstoned = 0;

CREATE TRIGGER mention_verdict_hides AFTER INSERT ON jev_verdict
WHEN NEW.question_id = 'mention_is_about_brand' AND NEW.p < 0.5 AND NEW.signal_id IS NOT NULL
BEGIN
  UPDATE signal SET is_tombstoned = 1 WHERE id = NEW.signal_id AND kind = 'mention';
END;

CREATE TRIGGER mention_verdict_link_hides AFTER UPDATE OF signal_id ON jev_verdict
WHEN NEW.question_id = 'mention_is_about_brand' AND NEW.p < 0.5 AND NEW.signal_id IS NOT NULL
BEGIN
  UPDATE signal SET is_tombstoned = 1 WHERE id = NEW.signal_id AND kind = 'mention';
END;
