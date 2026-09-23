-- Opaque and rotatable: a random token in a column, never derived and never
-- signed. Rotating it is an UPDATE, and the old value 404s immediately because
-- the lookup misses — a row lookup, not a signature check. The same pattern as
-- workspace.card_slug in 0003.
--
-- NULL is the never-sent state. SQLite allows many NULLs in a UNIQUE index, so
-- every target that has not been sent yet shares the empty state without
-- colliding. No backfill: the first send writes the token.
ALTER TABLE send_target ADD COLUMN unsubscribe_token TEXT;

-- The unsubscribe route's only lookup: token -> send_target. A UNIQUE index
-- makes it a single indexed read with no scan, and it makes two targets holding
-- the same token a write error rather than a public URL that resolves to the
-- wrong address.
CREATE UNIQUE INDEX idx_send_target_unsubscribe_token ON send_target(unsubscribe_token);
