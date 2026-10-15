ALTER TABLE workspace ADD COLUMN slack_brief INTEGER NOT NULL DEFAULT 0 CHECK (slack_brief IN (0, 1));
