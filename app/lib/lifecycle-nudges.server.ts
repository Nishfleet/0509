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
}): LifecycleNudge[] {
  const nudges: LifecycleNudge[] = [];
  const itemById = new Map(input.items.map((item) => [item.id, item]));
  const counts = input.counts;
  const proofUsage = input.proofUsage ?? null;

  if (counts.competitors === 0) {
    nudges.push({
      id: "first_competitor",
      title: "No first watchlist yet",
      detail: "Add one competitor so the first sweep and proof trail can start.",
      href: "/search",
      priority: "high",
    });
  } else if (counts.activeWatchlists === 0) {
    nudges.push({
      id: "first_watchlist",
      title: "Watchlist is paused",
      detail: "Resume or create one active watchlist so retained checks can run.",
      href: "/app/watchlists",
      priority: "high",
    });
  } else if (counts.successfulProofs === 0) {
    nudges.push({
      id: "first_proof",
      title: "First proof is missing",
      detail: "Refresh an active watchlist to attach landing-page evidence before sharing the account.",
      href: "/app/watchlists",
      priority: "high",
    });
  }

  if (counts.competitors > 0 && counts.sentDigests === 0) {
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
      title: "Delivery proof is missing",
      detail: "A destination exists but has no successful delivery yet.",
      href: "/app/sources",
      priority: "high",
    });
  } else if (counts.sentDigests > 0 && counts.deliveryTargets === 0) {
    nudges.push({
      id: "delivery_proof",
      title: "Delivery setup is missing",
      detail: "Digest history exists, but no active delivery target is configured.",
      href: "/app/sources",
      priority: "medium",
    });
  }

  if (counts.activeApiKeys === 0) {
    nudges.push({
      id: "agent_setup",
      title: "Agent setup is missing",
      detail: "Create an API key so agents can read readiness and run audited workspace actions.",
      href: "/app/sources",
      priority: "medium",
    });
  }

  if ((counts.clientRooms ?? 0) === 0 && counts.activeWatchlists > 0) {
    nudges.push({
      id: "client_room_setup",
      title: "No client room yet",
      detail: "Group one watchlist or report into a client room before agency handoff.",
      href: "/app/clients",
      priority: "low",
    });
  } else if ((counts.clientRooms ?? 0) > 0 && (counts.agentMemoryEntries ?? 0) === 0) {
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
      detail: `${proofUsage.used ?? 0} of ${proofUsage.limit ?? 0} evidence checks are used.`,
      href: "/app/billing",
      priority: proofUsage.warningLevel === "exhausted" ? "high" : "medium",
    });
  }

  if (input.hasPaymentIssue) {
    nudges.push({
      id: "payment_issue",
      title: "Payment issue",
      detail: "Dodo is retrying the last renewal payment. Review billing before access is affected.",
      href: "/app/billing",
      priority: "high",
    });
  }

  if (input.includeBillingSupport ?? true) {
    nudges.push({
      id: "billing_support",
      title: "Cancellation and help path",
      detail: "Plan changes, cancellation, receipts, invoices, and sensitive requests now open as support cases.",
      href: "/app/support?category=billing",
      priority: "low",
    });
  }

  return dedupeNudges(nudges);
}

function dedupeNudges(nudges: LifecycleNudge[]) {
  return Array.from(new Map(nudges.map((nudge) => [nudge.id, nudge])).values());
}
