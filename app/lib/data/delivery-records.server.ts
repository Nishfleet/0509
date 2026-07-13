/**
 * Delivery-records domain barrel (attempts / targets / workspace delivery
 * config bookkeeping). Named to avoid clashing with the sender module
 * `~/lib/delivery.server`. Product code should keep importing from
 * `~/lib/data.server` until later migration PRs.
 */

export {
  legacyWorkspaceDeliveryDefaults,
  migrateAutoProvisionedEmailTargets,
  getWorkspaceDeliveryConfig,
  upsertWorkspaceDeliveryConfig,
  getUserDeliveryProfile,
} from "~/lib/data/delivery-records-workspace.server";

export {
  listDeliveryTargets,
  getDeliveryTargetReadinessStats,
  upsertDeliveryTarget,
  getDeliveryTargetById,
  getDeliveryTargetByProviderIdentifier,
} from "~/lib/data/delivery-records-targets.server";

export {
  listRetryableInstantAttempts,
  listDeliveryAttempts,
  getDeliveryAttemptByIdempotencyKey,
  reconcileDeliveryAttemptByProviderMessageId,
  createDeliveryAttempt,
  updateDeliveryAttemptResult,
} from "~/lib/data/delivery-records-attempts.server";
