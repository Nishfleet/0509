CREATE TABLE IF NOT EXISTS support_case (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('billing', 'source', 'delivery', 'account', 'team', 'security', 'migration', 'other')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  subject TEXT NOT NULL CHECK (length(trim(subject)) > 0 AND length(subject) <= 160),
  detail TEXT NOT NULL CHECK (length(trim(detail)) > 0 AND length(detail) <= 4000),
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_support_case_user_updated
  ON support_case(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_case_user_status_updated
  ON support_case(user_id, status, updated_at DESC);
