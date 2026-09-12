-- Self-serve cancellation / account deletion / email change (issue #3168).
--
-- The /status weakness said "Cancellation, deletion, and sensitive account
-- changes still use the hosted portal or support path." Until this migration,
-- /app/account only opened a support case for deletion and email changes. This
-- migration gives the in-app flows durable state so the customer can:
--
--   1. Request account deletion from /app/account, then click a one-time link
--      emailed to the current address to schedule a 7-day grace window. The
--      confirmation email carries a cancel-deletion link the user can hit
--      during the grace window to restore the account. Hard delete runs on
--      the existing retention sweep — no new wrangler cron.
--   2. Request an email change from /app/account. The verification link is
--      emailed to the NEW address. On click the address swaps, the OLD
--      address is notified, and other sessions are invalidated. Passkeys stay
--      bound to the user id (they don't carry the email).
--
-- Both audit tables deliberately do NOT FK-cascade on user delete: the audit
-- row must outlive the user so support/ops can answer "was this row ever
-- deleted?" later. The hard delete in the retention sweep clears the audit
-- rows for the deleted user only after the user row is gone, so the only
-- surviving artefact after a full delete is an anonymised summary in the
-- delivery_attempt log + the email_suppression entry.
--
-- Additive: no existing table, column, or read path changes. Existing routes
-- are unchanged until app.account.tsx wires the new actions.

CREATE TABLE IF NOT EXISTS account_deletion_request (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- The current address at request time, recorded so the cancel link keeps
  -- working after a separately-completed email change.
  email_at_request TEXT NOT NULL,
  -- 7-day grace window starts at requested_at and ends at scheduled_for.
  -- The hard delete runs any time scheduled_for < now AND status='pending'.
  requested_at TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  cancelled_at TEXT,
  completed_at TEXT,
  -- 'pending'  — user clicked the email link, grace timer running
  -- 'cancelled' — user clicked the cancel-deletion link in the grace window
  -- 'completed' — the retention sweep hard-deleted the user row
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'cancelled', 'completed')),
  -- Token hash of the cancel-deletion link. Same shape as password-reset:
  -- random secret, hashed before persistence, sent in the email URL.
  cancel_token_hash TEXT,
  cancel_token_expires_at TEXT
);

-- One pending deletion at a time per user. A second 'pending' request while
-- one is already pending is rejected at the action layer; this index makes
-- the lookup O(1) and protects the constraint if a request slips past it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_deletion_request_pending
  ON account_deletion_request(user_id)
  WHERE status = 'pending';

-- Sweep query: 'pending AND scheduled_for < now'. Partial index keeps it
-- tiny even as completed/cancelled rows accumulate.
CREATE INDEX IF NOT EXISTS idx_account_deletion_request_due
  ON account_deletion_request(scheduled_for)
  WHERE status = 'pending';

-- Cancel link lookup. Token hash collisions are not a concern at the row
-- count we expect; the lookup is always gated by token validity + expiry.
CREATE INDEX IF NOT EXISTS idx_account_deletion_request_cancel_token
  ON account_deletion_request(cancel_token_hash)
  WHERE status = 'pending' AND cancel_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS account_email_change_request (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- Snapshot both ends so the verification link can survive an unrelated
  -- address change in flight.
  current_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  -- 'pending'  — link emailed to new_email, awaiting click
  -- 'consumed' — user clicked the link; user.email has been swapped
  -- 'cancelled' — user dismissed the banner from /app/account before clicking
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'consumed', 'cancelled')),
  token_hash TEXT NOT NULL
);

-- One pending email change per user at a time. Second click on the
-- /app/account form while one is still pending returns 409 at the action.
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_email_change_request_pending
  ON account_email_change_request(user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_account_email_change_request_token
  ON account_email_change_request(token_hash)
  WHERE status = 'pending';