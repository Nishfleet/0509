export type LifecycleNudgePriority = "high" | "medium" | "low";

export interface LifecycleNudge {
  id:
    | "first_competitor"
    | "first_watchlist"
    | "first_proof"
    | "first_digest"
    | "delivery_proof"
    | "agent_setup"
    | "client_room_setup"
    | "client_context"
    | "proof_usage"
    | "payment_issue"
    | "billing_support";
  title: string;
  detail: string;
  href: string;
  priority: LifecycleNudgePriority;
}

interface ReadinessItemLike {
  id: string;
  status: string;
}

interface LifecycleCounts {
  competitors: number;
  activeWatchlists: number;
  completedScans?: number;
  noChangeBaselines?: number;
  successfulProofs: number;
  sentDigests: number;
  deliveryTargets: number;
  activeApiKeys: number;
  agentMemoryEntries?: number;
  clientRooms?: number;
}

interface ProofUsageLike {
  warningLevel?: string;
  used?: number;
  limit?: number;
}

export function buildLifecycleNudges(input: {
  items: ReadinessItemLike[];
  counts: LifecycleCounts;
  proofUsage?: ProofUsageLike | null;
  hasPaymentIssue?: boolean;
  includeBillingSupport?: boolean;
  canUseClientRooms?: boolean;
  canUseDeveloperAccess?: boolean;
}): LifecycleNudge[] {
  const nudges: LifecycleNudge[] = [];
  const itemById = new Map(input.items.map((item) => [item.id, item]));
  const counts = input.counts;
  const proofUsage = input.proofUsage ?? null;
  const hasFirstValue = counts.successfulProofs > 0 || (counts.noChangeBaselines ?? 0) > 0;
  let activationNudge: LifecycleNudge | null = null;

  if (counts.competitors === 0) {
    activationNudge = {
      id: "first_competitor",
      title: "No first watchlist yet",
      detail: "Add one competitor so the first sweep and source trail can start.",
      href: "/search",
      priority: "high",
    };
  } else if (counts.activeWatchlists === 0) {
    activationNudge = {
      id: "first_watchlist",
      title: "Watchlist is paused",
      detail: "Resume or create one active watchlist so retained checks can run.",
      href: "/app/watchlists",
      priority: "high",
    };
  } else if (!hasFirstValue) {
    activationNudge = {
      id: "first_proof",
      title: "First check is still waiting",
      detail: "Refresh the active watchlist to record a credible proof or an honest no-change baseline.",
      href: "/app/watchlists",
      priority: "high",
    };
  }

  if (!hasFirstValue) {
    const urgent = firstPreValueSafetyNudge(input, proofUsage);
    if (urgent && activationNudge) {
      return [urgent, { ...activationNudge, priority: "medium" }];
    }
    return activationNudge ? [activationNudge] : urgent ? [urgent] : [];
  }

  if (activationNudge) nudges.push(activationNudge);

  if (counts.sentDigests === 0) {
    nudges.push({
      id: "first_digest",
      title: "No first digest yet",
      detail: "Open Digests after the first monitored change or quiet check to confirm the delivery trail.",
      href: "/app/digests",
      priority: "medium",
    });
  }

  const delivery = itemById.get("delivery");
  if (delivery?.status === "needs_proof") {
    nudges.push({
      id: "delivery_proof",
      title: "Delivery check is missing",
      detail: "A destination exists but has no successful delivery yet.",
      href: "/app/notifications",
      priority: "high",
    });
  } else if (counts.sentDigests > 0 && counts.deliveryTargets === 0) {
    nudges.push({
      id: "delivery_proof",
      title: "Delivery setup is missing",
      detail: "Digest history exists, but no active delivery target is configured.",
      href: "/app/notifications",
      priority: "medium",
    });
  }

  if ((input.canUseDeveloperAccess ?? false) && counts.activeApiKeys === 0) {
    nudges.push({
      id: "agent_setup",
      title: "Developer access is missing",
      detail: "Create a read key for exports; enable approved actions only for trusted workflows.",
      href: "/app/developer-access",
      priority: "low",
    });
  }

  if ((input.canUseClientRooms ?? false) && (counts.clientRooms ?? 0) === 0 && counts.activeWatchlists > 0) {
    nudges.push({
      id: "client_room_setup",
      title: "No client room yet",
      detail: "Group one watchlist or report into a client room before agency handoff.",
      href: "/app/clients",
      priority: "low",
    });
  } else if (
    (input.canUseClientRooms ?? false) &&
    (counts.clientRooms ?? 0) > 0 &&
    (counts.agentMemoryEntries ?? 0) === 0
  ) {
    nudges.push({
      id: "client_context",
      title: "Client context is missing",
      detail: "Save account memory for goals, tone, or review cadence before the next agent run.",
      href: "/app/clients",
      priority: "medium",
    });
  }

  if (proofUsage?.warningLevel && proofUsage.warningLevel !== "ok") {
    nudges.push({
      id: "proof_usage",
      title: "Usage near cap",
      detail: `${proofUsage.used ?? 0} of ${proofUsage.limit ?? 0} proof captures are used.`,
      href: "/app/billing",
      priority: proofUsage.warningLevel === "exhausted" ? "high" : "medium",
    });
  }

  if (input.hasPaymentIssue) {
    nudges.push({
      id: "payment_issue",
      title: "Payment issue",
      detail: "Billing reported a payment issue. Review the current status before access is affected.",
      href: "/app/billing",
      priority: "high",
    });
  }

  if (input.includeBillingSupport ?? true) {
    nudges.push({
      id: "billing_support",
      title: "Cancellation and help path",
      detail: "Plan changes start from billing; cancellation, receipts, invoices, and sensitive requests keep a support path.",
      href: "/app/support?category=billing",
      priority: "low",
    });
  }

  return orderNudges(dedupeNudges(nudges));
}

function firstPreValueSafetyNudge(
  input: { hasPaymentIssue?: boolean },
  proofUsage: ProofUsageLike | null,
): LifecycleNudge | null {
  if (input.hasPaymentIssue) {
    return {
      id: "payment_issue",
      title: "Payment issue",
      detail: "Billing reported a payment issue. Review the current status before access is affected.",
      href: "/app/billing",
      priority: "high",
    };
  }
  if (proofUsage?.warningLevel === "exhausted") {
    return {
      id: "proof_usage",
      title: "Usage near cap",
      detail: `${proofUsage.used ?? 0} of ${proofUsage.limit ?? 0} proof captures are used.`,
      href: "/app/billing",
      priority: "high",
    };
  }
  return null;
}

function dedupeNudges(nudges: LifecycleNudge[]) {
  return Array.from(new Map(nudges.map((nudge) => [nudge.id, nudge])).values());
}

const postValueNudgeOrder: LifecycleNudge["id"][] = [
  "payment_issue",
  "proof_usage",
  "delivery_proof",
  "first_digest",
  "client_context",
  "client_room_setup",
  "agent_setup",
  "billing_support",
];

function orderNudges(nudges: LifecycleNudge[]) {
  const order = new Map(postValueNudgeOrder.map((id, index) => [id, index]));
  return [...nudges].sort(
    (left, right) =>
      (order.get(left.id) ?? postValueNudgeOrder.length) -
      (order.get(right.id) ?? postValueNudgeOrder.length),
  );
}
