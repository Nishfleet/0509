-- Plan-integrity audit (issue #3673).
--
-- Successor to scripts/plan-integrity-check.mjs, deleted in the 2026-09-19
-- scripts/ sweep (#3624). The audit now uses the repo's standard read-only
-- shape: one .sql file whose text is passed to `wrangler d1 execute --remote
-- --command "$(cat db/queries/plan-integrity.sql)"`, packaged as
-- `npm run billing:integrity`; the jq in that package.json line prints the
-- report and exits 1 when any row lands in `unexplained`. (`--file` is not
-- used: on remote D1 wrangler uploads the file and returns only execution
-- stats, not the SELECT rows.)
--
-- Every `user_plan` row whose plan is not 'free' is sorted into one bucket:
--
--   payment_evidence        the row carries a dodo_payment_id,
--                           dodo_subscription_id or dodo_customer_id, or the
--                           dodo_webhook_event ledger holds a plan-granting
--                           event for the user (the same event types that
--                           grant plans in app/lib/dodo-billing.server.ts).
--   explained_non_customer  no payment evidence, but a recognised
--                           non-customer reason:
--                             * user_id = 'billing-canary-0509' — the
--                               dedicated billing-canary identity provisioned
--                               by app/lib/billing-canary-identity.server.ts
--                               (its BILLING_CANARY_USER_ID constant; SQL
--                               cannot import it, so
--                               tests/plan-integrity-query.test.ts pins this
--                               literal to that constant and the two cannot
--                               drift), or
--                             * dodo_status = 'owner_grant' — an internal
--                               plan grant written directly to D1 (owner
--                               account, granted 2026-09-19). No money moved
--                               and no Dodo subscription exists, so no
--                               payment evidence will ever appear. This is
--                               the documented home of the 'owner_grant'
--                               dodo_status convention.
--   unexplained             everything else. These fail the audit.
--
-- Output columns are an 8-char user id prefix and the email domain only —
-- never raw emails — and the audit makes no writes.

WITH classified AS (
  SELECT
    substr(up.user_id, 1, 8) AS user_id_prefix,
    up.plan AS plan,
    up.dodo_status AS dodo_status,
    up.plan_updated_at AS plan_updated_at,
    CASE
      WHEN u.email IS NULL THEN NULL
      WHEN instr(u.email, '@') > 0 THEN lower(substr(u.email, instr(u.email, '@') + 1))
      ELSE NULL
    END AS email_domain,
    CASE
      WHEN up.dodo_payment_id IS NOT NULL
        OR up.dodo_subscription_id IS NOT NULL
        OR up.dodo_customer_id IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM dodo_webhook_event e
          WHERE e.user_id = up.user_id
            AND e.event_type IN (
              'payment.succeeded',
              'subscription.active',
              'subscription.plan_changed',
              'subscription.updated',
              'subscription.renewed'
            )
        )
      THEN 'payment_evidence'
      WHEN up.user_id = 'billing-canary-0509' THEN 'explained_non_customer'
      WHEN up.dodo_status = 'owner_grant' THEN 'explained_non_customer'
      ELSE 'unexplained'
    END AS bucket,
    CASE
      WHEN up.user_id = 'billing-canary-0509'
        THEN 'dedicated billing canary identity (BILLING_CANARY_USER_ID, app/lib/billing-canary-identity.server.ts)'
      WHEN up.dodo_status = 'owner_grant'
        THEN 'owner_grant internal grant written directly to D1 — no Dodo payment expected'
      ELSE NULL
    END AS non_customer_reason
  FROM user_plan up
  LEFT JOIN user u ON u.id = up.user_id
  WHERE up.plan <> 'free'
)
SELECT
  user_id_prefix,
  plan,
  dodo_status,
  plan_updated_at,
  email_domain,
  bucket,
  CASE WHEN bucket = 'explained_non_customer' THEN non_customer_reason ELSE NULL END AS reason
FROM classified
ORDER BY plan_updated_at DESC;
