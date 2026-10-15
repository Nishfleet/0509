-- Additive workspace setting: post the weekly brief to the connected Slack channel. Off until the owner turns it on.
ALTER TABLE workspace ADD COLUMN slack_brief INTEGER NOT NULL DEFAULT 0 CHECK (slack_brief IN (0, 1));
