-- Why a watchlist is paused matters: plan-limit auto-pauses should resume on
-- the next grant, but a customer's deliberate pause (or a retarget's
-- deactivated original) must never be force-resumed by a renewal webhook.
ALTER TABLE watchlist ADD COLUMN paused_reason TEXT;
