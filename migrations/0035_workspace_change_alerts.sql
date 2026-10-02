-- Additive workspace setting: email the moment a tracked rival changes price or plan.
ALTER TABLE workspace ADD COLUMN change_alerts INTEGER NOT NULL DEFAULT 1 CHECK (change_alerts IN (0, 1));
