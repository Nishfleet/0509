ALTER TABLE support_case ADD COLUMN request_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_case_user_request_key
  ON support_case(user_id, request_key)
  WHERE request_key IS NOT NULL;
