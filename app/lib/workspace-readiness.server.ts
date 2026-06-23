import { resolveCommercialAdSourceStatus } from "~/lib/ad-source.server";
import {
  listCustomerApiKeys,
  listAgentMemory,
  listClientRooms,
  listDigests,
  listRecentWorkspaceProofCaptures,
  listSavedQueries,
  listWatchlists,
  getDeliveryTargetReadinessStats,
  getSuccessfulProofCaptureStatsForUser,
  getUserPlanBillingInfo,
} from "~/lib/data.server";
import type { AppEnv } from "~/lib/env.server";
import { buildLifecycleNudges, type LifecycleNudge } from "~/lib/lifecycle-nudges.server";
import { getProofUsageSummary } from "~/lib/plan.server";
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
  items: WorkspaceReadinessItem[];
  counts: {
    competitors: number;
    activeWatchlists: number;
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

export async function getWorkspaceReadiness(
  env: AppEnv,
  userId: string,
): Promise<WorkspaceReadiness> {
  const [
    savedQueries,
    watchlists,
    proofCaptures,
    digests,
    deliveryTargetStats,
    proofUsage,
    billingInfo,
    members,
    apiKeys,
    sourceStatus,
    successfulProofStats,
    agentMemoryEntries,
    clientRooms,
  ] = await Promise.all([
    listSavedQueries(env, userId),
    listWatchlists(env, userId, { includeInactive: true }),
    listRecentWorkspaceProofCaptures(env, userId, 20),
    listDigests(env, userId),
    getDeliveryTargetReadinessStats(env, userId),
    getProofUsageSummary(env, userId),
    getUserPlanBillingInfo(env, userId),
    listWorkspaceMembers(env, userId),
    listCustomerApiKeys(env, userId),
    resolveCommercialAdSourceStatus(env),
    getSuccessfulProofCaptureStatsForUser(env, userId),
    listAgentMemory(env, userId, { limit: 100 }),
    listClientRooms(env, userId, { status: "active", limit: 100 }),
  ]);

  const competitorCount = watchlists.length;
  const activeWatchlists = watchlists.filter((watchlist) => watchlist.isActive).length;
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
    (billingInfo.dodoStatus === "subscription.failed" ||
      billingInfo.dodoStatus === "subscription.on_hold");

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
      action: activeWatchlists > 0 ? null : { label: "Open watchlists", href: "/app/watchlists" },
    },
    {
      id: "first_proof",
      label: "First proof",
      status: successfulProofs > 0 ? "ready" : proofUsage.used > 0 ? "needs_proof" : "needs_setup",
      detail:
        successfulProofs > 0
          ? `${successfulProofs} successful evidence check${successfulProofs === 1 ? "" : "s"} recorded.`
          : proofUsage.used > 0
            ? "Evidence attempts have run, but no successful proof is attached yet."
            : "Refresh a watchlist to capture landing-page evidence.",
      action: successfulProofs > 0 ? null : { label: "Open watchlists", href: "/app/watchlists" },
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
      label: "Delivery proof",
      status:
        deliveryProofCount > 0
          ? "ready"
          : activeDeliveryTargetCount > 0
            ? "needs_proof"
            : "needs_setup",
      detail:
        deliveryProofCount > 0
          ? "A delivery path has successful proof."
          : activeDeliveryTargetCount > 0
            ? "A delivery target exists but needs successful delivery proof."
            : sentDigests > 0
              ? "Digest history exists, but no active delivery target is configured."
              : "Connect email or Slack when the team wants proof pushed out.",
      action:
        deliveryProofCount > 0
          ? null
          : { label: "Open sources", href: "/app/sources" },
    },
    {
      id: "billing",
      label: "Billing and proof credits",
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
            ? `${proofUsage.remaining} evidence checks left this month.`
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
      label: "Data sources",
      status:
        sourceStatus.status === "healthy"
          ? "ready"
          : sourceStatus.status === "cache_only" || sourceStatus.status === "degraded"
            ? "attention"
            : "needs_setup",
      detail: sourceStatus.summary,
      action: sourceStatus.status === "healthy" ? null : { label: "Open sources", href: "/app/sources" },
    },
    {
      id: "api",
      label: "Customer API",
      status: activeApiKeys > 0 ? "ready" : "needs_setup",
      detail:
        activeApiKeys > 0
          ? `${activeApiKeys} active API key${activeApiKeys === 1 ? "" : "s"}.`
          : "Create an API key for account-owned exports.",
      action: activeApiKeys > 0 ? null : { label: "Open sources", href: "/app/sources" },
    },
    {
      id: "mcp",
      label: "MCP agent context",
      status: actionEnabledApiKeys > 0 ? "ready" : activeApiKeys > 0 ? "attention" : "needs_setup",
      detail:
        actionEnabledApiKeys > 0
          ? "MCP can use a write-enabled API key for readiness, exports, and audited actions."
          : activeApiKeys > 0
            ? "MCP can use read-only API keys for readiness and exports. Create a write-enabled key for audited actions."
          : "Create an API key before connecting MCP clients.",
      action: actionEnabledApiKeys > 0 ? null : { label: "Open sources", href: "/app/sources" },
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
    items,
    counts: {
      competitors: competitorCount,
      activeWatchlists,
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
        successfulProofs,
        sentDigests,
        deliveryTargets: activeDeliveryTargetCount,
        activeApiKeys,
        agentMemoryEntries: agentMemoryEntries.length,
        clientRooms: clientRooms.length,
      },
      proofUsage,
      hasPaymentIssue: hasBillingPaymentIssue,
    }),
  };
}
