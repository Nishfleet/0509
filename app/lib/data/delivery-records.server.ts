/**
 * Delivery-records domain barrel (attempts / targets / workspace delivery
 * config bookkeeping). Named to avoid clashing with the sender module
 * `~/lib/delivery.server`. Product code should keep importing from
 * `~/lib/data.server` until later migration PRs.
 */

export {
  legacyWorkspaceDeliveryDefaults,
  ensureNewWorkspaceDeliveryDefaults,
  migrateAutoProvisionedEmailTargets,
  getWorkspaceDeliveryConfig,
  upsertWorkspaceDeliveryConfig,
  getUserDeliveryProfile,
} from "~/lib/data/delivery-records-workspace.server";

export {
  listDeliveryTargets,
  hasSuppressedEmailTargetForUserAndAddress,
  provisionVerifiedAccountEmailTargetIfUnsuppressed,
  getDeliveryTargetReadinessStats,
  upsertDeliveryTarget,
  getDeliveryTargetById,
  getDeliveryTargetByProviderIdentifier,
  claimEmailTargetForDispatch,
  suppressEmailTargetsForUserAndAddress,
  resumeEmailTargetsForUserAndAddress,
  reconcileWhatsAppSetupTargetFromAttempt,
  reconcileWhatsAppSetupTargetByProviderMessageId,
} from "~/lib/data/delivery-records-targets.server";

export {
  listRetryableInstantAttempts,
  listStaleBillingLifecycleEmailAttempts,
  listOutstandingBillingLifecycleProviderUnknownAttempts,
  listOutstandingDigestProviderUnknownAttempts,
  listOutstandingInstantProviderUnknownAttempts,
  listDeliveryAttempts,
  getDeliveryAttemptByIdempotencyKey,
  claimInstantDeliveryAttempt,
  markInstantDeliveryDispatchStarted,
  reconcileDeliveryAttemptByProviderMessageId,
  createDeliveryAttempt,
  updateDeliveryAttemptResult,
  buildBillingLifecycleOutboxStatement,
  type BillingLifecycleEmailOutboxSpec,
  type BillingLifecycleOutboxGate,
  type InstantDeliveryAttemptClaimInput,
} from "~/lib/data/delivery-records-attempts.server";
