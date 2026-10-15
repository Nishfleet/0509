-- 0509#7191: one empty night was enough to paint GDELT "not answering", so a
-- single upstream blip degraded a source that was working the night before and
-- cleared it again the next morning. The pill flipped on and off with GDELT's
-- mood rather than telling the customer anything true.
--
-- A canary now takes two consecutive empty nights to degrade a source, and the
-- count of empty nights lives on the row so the decision survives a Worker
-- restart and is readable without the log. One good night clears both the
-- strikes and the reason, so a blip costs nothing.
--
-- Expand-only phase 1 (nullable add): NULL and 0 both read as "no failed night
-- yet", which is exactly what every existing row means. The previous Worker
-- version ignores the column, so a rollback is a code rollback and D1 has no
-- down step. No DROP, no rename, no NOT NULL without a DEFAULT.

ALTER TABLE source ADD COLUMN canary_strikes INTEGER;
