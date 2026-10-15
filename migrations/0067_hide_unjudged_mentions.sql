-- 0067_hide_unjudged_mentions.sql — a mention nobody has judged yet is not shown
-- anywhere. Insert now tombstones it and the re-judge un-hides the ones that are
-- about the brand; this hides the ones already stored. Rows are kept so the
-- re-judge still finds them.
UPDATE signal SET is_tombstoned = 1 WHERE kind = 'mention' AND state = 'unjudged' AND is_tombstoned = 0;
