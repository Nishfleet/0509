import { resolveCommercialAdSourceStatus } from "~/lib/ad-source.server";
import { customerDiscoverySummary } from "~/lib/discovery-customer-copy";
import {
  listCustomerApiKeys,
  listAgentMemory,
  listClientRooms,
  listDigests,
  listRecentWorkspaceProofCaptures,
  listSavedQueries,
  listWatchlists,
  getDeliveryTargetReadinessStats,
  getSuccessfulRunStatsForUserBetween,
  getSuccessfulProofCaptureStatsForUser,
  getUserPlanBillingInfo,
} from "~/lib/data.server";
import type { AppEnv } from "~/lib/env.server";
import { buildLifecycleNudges, type LifecycleNudge } from "~/lib/lifecycle-nudges.server";
import { TOP_UP_PACK_DISPLAY } from "~/lib/billing-sku-catalog";
import { getProofUsageSummary, listActiveProofCreditGrants } from "~/lib/plan.server";
import { listWorkspaceMembers } from "~/lib/workspace.server";

export type WorkspaceReadinessStatus =
  | "ready"
  | "needs_setup"
  | "needs_proof"
  | "attention"
  | "not_applicable";

export interface WorkspaceReadinessAction {
  label: string;
  href: string;
}

export interface WorkspaceReadinessItem {
  id:
    | "first_competitor"
    | "first_watchlist"
    | "first_proof"
    | "first_digest"
    | "delivery"
    | "billing"
    | "team"
    | "source"
    | "api"
    | "mcp";
  label: string;
  status: WorkspaceReadinessStatus;
  detail: string;
  action: WorkspaceReadinessAction | null;
}

export interface WorkspaceReadiness {
  status: Exclude<WorkspaceReadinessStatus, "needs_proof" | "not_applicable">;
  readyCount: number;
  totalCount: number;
  value: {
    hasFirstValue: boolean;
    hasRecurringPaidCadence: boolean;
    hasRetainedReadiness: boolean;
  };
  workspace: {
    workspaceUserId: string;
    isMember: boolean;
    billingOwnerName: string | null;
    canManageBilling: boolean;
  };
  billing: {
    plan: "free" | "scout" | "starter" | "agency";
    billingInterval: "monthly" | "annual" | null;
    dodoStatus: string | null;
    nextBillingAt: string | null;
    planUpdatedAt: string | null;
    hasPaymentIssue: boolean;
    proofUsage: {
      used: number;
      baseLimit: number;
      extraCredits: number;
      limit: number;
      remaining: number;
      warningLevel: "ok" | "warning" | "exhausted";
      periodStart: string | null;
      periodEnd: string | null;
      nextPeriodStart: string | null;
      includedRemaining: number | null;
      topUpRemaining: number;
      topUpRetainedWhileInactive: number;
      canSpendTopUps: boolean | null;
    };
    topUpGrants: Array<{
      skuSlug: string | null;
      packName: string;
      remainingCredits: number;
      grantedAt: string;
      expiresAt: string | null;
    }>;
  };
  items: WorkspaceReadinessItem[];
  counts: {
    competitors: number;
    activeWatchlists: number;
    completedScans: number;
    noChangeBaselines: number;
    successfulProofs: number;
    sentDigests: number;
    deliveryTargets: number;
    activeApiKeys: number;
    actionEnabledApiKeys: number;
    teamMembers: number;
    agentMemoryEntries: number;
    clientRooms: number;
  };
  nudges: LifecycleNudge[];
}

export interface WorkspaceReadinessOptions {
  isMember?: boolean;
  billingOwnerName?: string | null;
  canManageBilling?: boolean;
}

export async function getWorkspaceReadiness(
  env: AppEnv,
  userId: string,
  options: WorkspaceReadinessOptions = {},
): Promise<WorkspaceReadiness> {
  const [
    savedQueries,
    watchlists,
    proofCaptures,
    digests,
    deliveryTargetStats,
    proofUsage,
    creditGrants,
    billingInfo,
    members,
    apiKeys,
    sourceStatus,
    successfulProofStats,
    successfulRunStats,
    agentMemoryEntries,
    clientRooms,
  ] = await Promise.all([
    listSavedQueries(env, userId),
    listWatchlists(env, userId, { includeInactive: true }),
    listRecentWorkspaceProofCaptures(env, userId, 20),
    listDigests(env, userId),
    getDeliveryTargetReadinessStats(env, userId),
    getProofUsageSummary(env, userId),
    listActiveProofCreditGrants(env, userId),
    getUserPlanBillingInfo(env, userId),
    listWorkspaceMembers(env, userId),
    listCustomerApiKeys(env, userId),
    resolveCommercialAdSourceStatus(env),
    getSuccessfulProofCaptureStatsForUser(env, userId),
    getSuccessfulRunStatsForUserBetween(
      env,
      userId,
      "1970-01-01T00:00:00.000Z",
      new Date().toISOString(),
    ),
    listAgentMemory(env, userId, { limit: 100 }),
    listClientRooms(env, userId, { status: "active", limit: 100 }),
  ]);

  const competitorCount = watchlists.length;
  const activeWatchlists = watchlists.filter((watchlist) => watchlist.isActive).length;
  const completedScans = successfulRunStats.runs;
  const noChangeBaselines = successfulRunStats.noChangeRuns;
  const recentSuccessfulProofs = proofCaptures.filter((capture) => capture.status === "succeeded").length;
  const successfulProofs = successfulProofStats.count || recentSuccessfulProofs;
  const sentDigests = digests.filter((digest) => digest.delivery?.status === "sent").length;
  const activeDeliveryTargetCount = deliveryTargetStats.activeCount;
  const deliveryProofCount = deliveryTargetStats.provenCount;
  const activeApiKeys = apiKeys.filter((apiKey) => !apiKey.revokedAt).length;
  const actionEnabledApiKeys = apiKeys.filter((apiKey) => !apiKey.revokedAt && apiKey.actionsWriteEnabled).length;
  const isAgency = billingInfo.plan === "agency";
  const hasBillingPaymentIssue =
    billingInfo.plan !== "free" &&
    (billingInfo.dodoStatus === "payment.failed" ||
      billingInfo.dodoStatus === "subscription.failed" ||
      billingInfo.dodoStatus === "subscription.on_hold");
  const hasFirstValue = successfulProofs > 0 || noChangeBaselines > 0;
  const hasRecurringPaidCadence = billingInfo.plan !== "free" && activeWatchlists > 0;
  const hasRetainedReadiness =
    hasFirstValue &&
    hasRecurringPaidCadence &&
    sentDigests > 0 &&
    deliveryProofCount > 0 &&
    !hasBillingPaymentIssue;
  const isMember = options.isMember ?? false;
  const canManageBilling = options.canManageBilling ?? !isMember;

  const items: WorkspaceReadinessItem[] = [
    {
      id: "first_competitor",
      label: "First competitor",
      status: savedQueries.length > 0 || competitorCount > 0 ? "ready" : "needs_setup",
      detail:
        competitorCount > 0
          ? `${competitorCount} competitor${competitorCount === 1 ? "" : "s"} saved.`
          : savedQueries.length > 0
            ? "Competitor search exists."
            : "Paste one competitor website to start.",
      action: savedQueries.length > 0 || competitorCount > 0
        ? null
        : { label: "Search competitor", href: "/search" },
    },
    {
      id: "first_watchlist",
      label: "First watchlist",
      status: activeWatchlists > 0 ? "ready" : competitorCount > 0 ? "attention" : "needs_setup",
      detail:
        activeWatchlists > 0
          ? `${activeWatchlists} active watchlist${activeWatchlists === 1 ? "" : "s"}.`
          : competitorCount > 0
            ? "A watchlist exists but is paused."
            : "Create one retained watchlist.",
      action: activeWatchlists > 0 ? null : { label: "Add a competitor", href: "/app/watchlists" },
    },
    {
      id: "first_proof",
      label: "First evidence",
      status: hasFirstValue ? "ready" : proofUsage.used > 0 ? "needs_proof" : "needs_setup",
      detail:
        successfulProofs > 0
          ? `${successfulProofs} successful proof capture${successfulProofs === 1 ? "" : "s"} recorded.`
          : noChangeBaselines > 0
            ? `${noChangeBaselines} successful no-change baseline${noChangeBaselines === 1 ? "" : "s"} recorded.`
          : proofUsage.used > 0
            ? "Evidence attempts have run, but no successful source is attached yet."
            : "Refresh a watchlist to capture landing-page evidence.",
      action: hasFirstValue ? null : { label: "Capture evidence", href: "/app/watchlists" },
    },
    {
      id: "first_digest",
      label: "First digest",
      status: sentDigests > 0 ? "ready" : "needs_setup",
      detail:
        sentDigests > 0
          ? `${sentDigests} digest${sentDigests === 1 ? "" : "s"} sent.`
          : "Digest history appears after monitored changes.",
      action: sentDigests > 0 ? null : { label: "Open digests", href: "/app/digests" },
    },
    {
      id: "delivery",
      label: "Delivery check",
      status:
        deliveryProofCount > 0
          ? "ready"
          : activeDeliveryTargetCount > 0
            ? "needs_proof"
            : "needs_setup",
      detail:
        deliveryProofCount > 0
          ? "A delivery path has a successful check."
          : activeDeliveryTargetCount > 0
            ? "A delivery target exists but needs a successful delivery check."
            : sentDigests > 0
              ? "Digest history exists, but no active delivery target is configured."
              : "Connect email when the team wants briefs pushed out.",
      action:
        deliveryProofCount > 0
          ? null
          : { label: "Open notifications", href: "/app/notifications" },
    },
    {
      id: "billing",
      label: "Billing and proof capture packs",
      status:
        hasBillingPaymentIssue || proofUsage.warningLevel === "exhausted"
          ? "attention"
          : proofUsage.limit > 0
            ? "ready"
            : "needs_setup",
      detail:
        hasBillingPaymentIssue
          ? "Payment issue needs review before retained monitoring is ready."
          : proofUsage.limit > 0
            ? `${proofUsage.remaining} proof captures left this month.`
            : "Choose a plan before retained monitoring.",
      action:
        proofUsage.limit > 0 && !hasBillingPaymentIssue
          ? null
          : { label: "Open billing", href: "/app/billing" },
    },
    {
      id: "team",
      label: "Team setup",
      status: members.length > 0 ? "ready" : isAgency ? "needs_setup" : "not_applicable",
      detail:
        members.length > 0
          ? `${members.length} teammate${members.length === 1 ? "" : "s"} invited.`
          : isAgency
            ? "Agency workspaces can invite teammates."
            : "Team seats are available on Agency.",
      action:
        members.length > 0 || !isAgency ? null : { label: "Invite teammate", href: "/app/team" },
    },
    {
      id: "source",
      label: "Source access",
      status:
        sourceStatus.status === "healthy"
          ? "ready"
          : sourceStatus.status === "cache_only" || sourceStatus.status === "degraded"
            ? "attention"
            : "needs_setup",
			detail: customerDiscoverySummary(sourceStatus.summary) ?? sourceStatus.summary,
      action: sourceStatus.status === "healthy" ? null : { label: "Open source access", href: "/app/source-access" },
    },
    {
      id: "api",
      label: "Developer access",
      status: !isAgency ? "not_applicable" : activeApiKeys > 0 ? "ready" : "needs_setup",
      detail:
        !isAgency
          ? "Developer access is available on Agency."
          : activeApiKeys > 0
          ? `${activeApiKeys} active API key${activeApiKeys === 1 ? "" : "s"} for exports and automation.`
          : "Create an API key when you need exports, webhooks, or developer connections.",
      action: !isAgency || activeApiKeys > 0 ? null : { label: "Set up developer access", href: "/app/developer-access" },
    },
  ];

  const actionableItems = items.filter((item) => item.status !== "not_applicable");
  const readyCount = actionableItems.filter((item) => item.status === "ready").length;
  const attentionCount = actionableItems.filter((item) => item.status === "attention").length;
  const status =
    readyCount === actionableItems.length
      ? "ready"
      : attentionCount > 0
        ? "attention"
        : "needs_setup";

  return {
    status,
    readyCount,
    totalCount: actionableItems.length,
    value: {
      hasFirstValue,
      hasRecurringPaidCadence,
      hasRetainedReadiness,
    },
    workspace: {
      workspaceUserId: userId,
      isMember,
      billingOwnerName: options.billingOwnerName ?? null,
      canManageBilling,
    },
    billing: {
      plan: billingInfo.plan,
      billingInterval: billingInfo.billingInterval,
      dodoStatus: billingInfo.dodoStatus,
      nextBillingAt: billingInfo.dodoNextBillingAt,
      planUpdatedAt: billingInfo.planUpdatedAt,
      hasPaymentIssue: hasBillingPaymentIssue,
      proofUsage: {
        used: proofUsage.used,
        baseLimit: proofUsage.baseLimit,
        extraCredits: proofUsage.extraCredits,
        limit: proofUsage.limit,
        remaining: proofUsage.remaining,
        warningLevel: proofUsage.warningLevel,
        periodStart: proofUsage.periodStart ?? null,
        periodEnd: proofUsage.periodEnd ?? null,
        nextPeriodStart: proofUsage.nextPeriodStart ?? null,
        includedRemaining: proofUsage.includedRemaining ?? null,
        topUpRemaining: proofUsage.topUpRemaining ?? proofUsage.extraCredits ?? 0,
        topUpRetainedWhileInactive: proofUsage.topUpRetainedWhileInactive ?? 0,
        canSpendTopUps: proofUsage.canSpendTopUps ?? null,
      },
      topUpGrants: creditGrants.map((grant) => ({
        skuSlug: grant.skuSlug,
        packName: topUpPackName(grant.skuSlug, grant.credits),
        remainingCredits: grant.credits,
        grantedAt: grant.grantedAt,
        expiresAt: grant.expiresAt,
      })),
    },
    items,
    counts: {
      competitors: competitorCount,
      activeWatchlists,
      completedScans,
      noChangeBaselines,
      successfulProofs,
      sentDigests,
      deliveryTargets: activeDeliveryTargetCount,
      activeApiKeys,
      actionEnabledApiKeys,
      teamMembers: members.length,
      agentMemoryEntries: agentMemoryEntries.length,
      clientRooms: clientRooms.length,
    },
    nudges: buildLifecycleNudges({
      items,
      counts: {
        competitors: competitorCount,
        activeWatchlists,
        completedScans,
        noChangeBaselines,
        successfulProofs,
        sentDigests,
        deliveryTargets: activeDeliveryTargetCount,
        activeApiKeys,
        agentMemoryEntries: agentMemoryEntries.length,
        clientRooms: clientRooms.length,
      },
      proofUsage,
      hasPaymentIssue: hasBillingPaymentIssue,
      canUseClientRooms: isAgency,
      canUseDeveloperAccess: isAgency,
    }),
  };
}

function topUpPackName(skuSlug: string | null | undefined, credits: number) {
  if (skuSlug && skuSlug in TOP_UP_PACK_DISPLAY) {
    return TOP_UP_PACK_DISPLAY[skuSlug as keyof typeof TOP_UP_PACK_DISPLAY].name;
  }
  return `${credits.toLocaleString("en-IN")} proof-capture pack`;
}
