-- Watchlists scan the country their owner searched from. Before this column
-- the scan country was hardcoded to India regardless of who created the
-- watchlist; existing rows stay NULL and keep the legacy India behavior.
ALTER TABLE watchlist ADD COLUMN target_country TEXT;
