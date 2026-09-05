-- Client-branded shared reports (Agency plan).
-- One optional brand name per workspace; rendered as "Prepared by {brand_name}"
-- on shared reports. Co-branding only — Five to Nine stays in the footer.
CREATE TABLE workspace_branding (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  brand_name TEXT,
  updated_at TEXT NOT NULL
);
