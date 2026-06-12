-- Share links were permanent bearer tokens: no expiry, no revocation, no way
-- for a customer to un-share. New links get a default expiry at creation
-- time; existing rows keep expires_at NULL so links customers already sent
-- out keep working until they are revoked.
ALTER TABLE share_link ADD COLUMN expires_at TEXT;
ALTER TABLE share_link ADD COLUMN revoked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_share_link_user_created
  ON share_link(user_id, created_at DESC);
