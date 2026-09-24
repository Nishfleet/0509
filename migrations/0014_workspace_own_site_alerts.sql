-- Additive workspace setting for own-site incident email delivery.
ALTER TABLE workspace ADD COLUMN own_site_alerts INTEGER NOT NULL DEFAULT 1 CHECK (own_site_alerts IN (0, 1));
