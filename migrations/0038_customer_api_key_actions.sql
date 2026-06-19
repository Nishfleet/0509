ALTER TABLE customer_api_key
  ADD COLUMN actions_write_enabled INTEGER NOT NULL DEFAULT 0;
