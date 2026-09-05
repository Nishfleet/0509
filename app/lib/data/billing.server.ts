/**
 * Billing domain barrel. Product code should keep importing from
 * `~/lib/data.server` until later migration PRs; reconcile orchestrators may
 * import watchlist builders from `watchlist-plan-reconcile.server` directly.
 */

export {
  grantProofUsageCredit,
  applyDodoProofCreditGrantWithLedger,
} from "~/lib/data/billing-credits.server";

export {
  grantDodoPlanAccess,
  revokeDodoPlanAccess,
  markDodoPlanPaymentIssue,
  revokeDodoAccessForRefundedPayment,
  getUserIdForDodoPayment,
  getUserIdForDodoLifecycle,
  getUserPlanBillingInfo,
  type UserPlanBillingInfo,
} from "~/lib/data/billing-plan.server";

export {
  DODO_WEBHOOK_PROCESSING_LEASE_MS,
  finalizeDodoWebhookLedgerOnly,
  beginDodoWebhookEventProcessing,
  claimDodoWebhookEvent,
  failDodoWebhookEventProcessing,
  failDodoWebhookEventForLifecycleEmailRetry,
  markDodoWebhookEventFinished,
  type DodoWebhookLedgerOutcome,
  type DodoWebhookLedgerFinalize,
  type DodoWebhookProcessingClaim,
} from "~/lib/data/billing-webhook-ledger.server";

export {
  DODO_PLAN_CHECKOUT_LOCK_MINUTES,
  DODO_SUBSCRIPTION_PLAN_CHANGE_LOCK_MINUTES,
  DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS,
  DODO_SUBSCRIPTION_PLAN_CHANGE_SCHEDULED_STATUS,
  isDodoSubscriptionPlanChangeStatus,
  isBlockingDodoSubscriptionPlanChangeStatus,
  claimDodoSubscriptionPlanChange,
  clearDodoSubscriptionPlanChangeClaim,
  markDodoSubscriptionPlanChangeScheduled,
  claimDodoPlanCheckout,
  clearDodoPlanCheckout,
} from "~/lib/data/billing-checkout.server";

export {
  isDodoSubscriptionPlanChangeReconciliationDue,
  listStaleDodoSubscriptionPlanChangeClaims,
  reconcileDodoSubscriptionPlanChangeWithAudit,
  type DodoPlanChangeReconciliationInput,
  type DodoPlanChangeReconciliationOutcome,
} from "~/lib/data/billing-plan-change-reconciliation.server";

export {
  applyDodoCancellationReversalWithLedger,
  applyDodoPlanGrantWithWatchlistReconcile,
  applyDodoPlanRevokeWithWatchlistReconcile,
  applyDodoRefundWithWatchlistReconcile,
  applyDodoPlanPaymentIssueWithLedger,
} from "~/lib/data/billing-reconcile.server";
