import type {
  WorkspaceReadiness,
  WorkspaceReadinessItem,
} from "~/lib/workspace-readiness.server";

export const BLOCKING_SETUP_ITEM_IDS = [
  "first_competitor",
  "first_watchlist",
  "first_proof",
  "first_digest",
] as const;

const BLOCKING_SETUP_ITEMS = new Set<string>(BLOCKING_SETUP_ITEM_IDS);

export function isBlockingSetupItem(item: WorkspaceReadinessItem) {
  return BLOCKING_SETUP_ITEMS.has(item.id);
}

export function isBlockingSetupItemComplete(
  readiness: WorkspaceReadiness,
  item: WorkspaceReadinessItem,
) {
  if (item.status === "ready" || item.status === "not_applicable") return true;

  // Pausing a watchlist is an operational choice, not a return to onboarding.
  // A saved competitor (or a later durable milestone) proves this setup step
  // was completed even when there is no currently-active watchlist.
  if (item.id === "first_watchlist") {
    return (
      (readiness.counts?.competitors ?? 0) > 0 ||
      (readiness.counts?.successfulProofs ?? 0) > 0 ||
      readiness.items.some(
        (candidate) =>
          (candidate.id === "first_proof" || candidate.id === "first_digest") &&
          candidate.status === "ready",
      )
    );
  }

  return false;
}

export function blockingSetupItems(readiness: WorkspaceReadiness) {
  return readiness.items.filter(isBlockingSetupItem);
}

export function pendingBlockingSetupItems(readiness: WorkspaceReadiness) {
  return blockingSetupItems(readiness).filter(
    (item) => !isBlockingSetupItemComplete(readiness, item),
  );
}
