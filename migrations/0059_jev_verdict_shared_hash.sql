ALTER TABLE jev_verdict ADD COLUMN shared_hash TEXT;
CREATE INDEX idx_jev_verdict_shared ON jev_verdict(question_id, shared_hash) WHERE shared_hash IS NOT NULL;
