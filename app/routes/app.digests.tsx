import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { DesignedDigestBrief } from "~/components/digest-intelligence";
import { CopyButton } from "~/components/copy-button";
import { SecondaryAction } from "~/components/evidence/cta";
import { SpecimenEmptyState } from "~/components/evidence/specimen-empty-state";
import { LocalTime } from "~/components/local-time";
import { LockedFeature } from "~/components/locked-feature";
import { SubmitButton } from "~/components/submit-button";
import { readDigestIntelligence } from "~/lib/change-intelligence";
import { toPublicDeliveryAttemptSummary } from "~/lib/delivery-attempt-public";
import { formatWatchEventTypeLabel } from "~/lib/landing-page-display";
import { canUsePlanFeature } from "~/lib/plan-entitlements";
import { classifyDigestItemSource } from "~/lib/proof-classification";

export const meta = () => [{ title: "Briefs | Five to Nine" }];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Briefs" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { PLAN_LIMITS, getUserPlan } = await import("~/lib/plan.server");
  const { getDigest, listDeliveryAttempts, listDigests } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);
  const plan = await getUserPlan(env, workspaceUserId);

  if (!PLAN_LIMITS[plan].digests) {
    return {
      digests: [],
      selectedDigest: null,
      canAccessDigests: false,
    };
  }

  const [digests, recentDeliveryAttempts] = await Promise.all([
    listDigests(env, workspaceUserId),
    listDeliveryAttempts(env, {
      userId: workspaceUserId,
      limit: 80,
    }),
  ]);
  const url = new URL(request.url);
  const selectedDigestId = url.searchParams.get("digest") ?? digests[0]?.id ?? null;
  const selectedDigestCandidate = selectedDigestId ? await getDigest(env, selectedDigestId) : null;
  const selectedDigest =
    selectedDigestCandidate?.userId === workspaceUserId ? selectedDigestCandidate : null;

  return {
    digests,
    digestAttemptsByDigestId: Object.fromEntries(
      digests.map((digest) => [
        digest.id,
        summarizeDigestAttempts(
          recentDeliveryAttempts.filter((attempt) => attempt.digestRunId === digest.id),
        ).map(toPublicDeliveryAttemptSummary),
      ]),
    ),
    selectedDigest,
    selectedDigestAttempts: selectedDigest
      ? summarizeDigestAttempts(
          recentDeliveryAttempts.filter((attempt) => attempt.digestRunId === selectedDigest.id),
        ).map(toPublicDeliveryAttemptSummary)
      : [],
    canAccessDigests: true,
    plan,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { PLAN_LIMITS, getUserPlan } = await import("~/lib/plan.server");
  const { createShareLink, getDigest } = await import("~/lib/data.server");
  const env = getEnv(context);
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const plan = await getUserPlan(env, workspaceUserId);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (!PLAN_LIMITS[plan].digests) {
    return {
      ok: false,
      error: "plan_limit_exceeded",
      message: "Briefs are included in paid plans — upgrade to turn them on.",
    };
  }

  if (intent === "share-digest") {
    const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
    const shareGate = await requireWorkspacePlanFeature(env, workspaceUserId, "share_links");
    if (!shareGate.ok) {
      return {
        ok: false,
        error: "plan_gated" as const,
        feature: "share_links" as const,
        plan: shareGate.plan,
        message: "Share links are included on Starter and Agency plans.",
      };
    }
    const digestId = String(formData.get("digestId") ?? "");
    const digest = await getDigest(env, digestId);

    if (!digest || digest.userId !== workspaceUserId) {
      return {
        ok: false,
        message: "We couldn't find that brief. Refresh the page and try again.",
      };
    }

    const { buildDigestShareSnapshot } = await import("~/lib/digest-share");
    const share = await createShareLink(
      env,
      { ...session, user: { ...session.user, id: workspaceUserId } },
      {
      resourceType: "digest",
      resourceId: digest.id,
      isSnapshot: true,
      snapshotPayload: buildDigestShareSnapshot(digest) as unknown as Record<string, unknown>,
    });

    return {
      ok: true,
      message: `${new URL(`/share/${share.token}`, request.url).toString()}`,
    };
  }

  return {
    ok: false,
    message: "We couldn't complete that action. Refresh the page and try again.",
  };
}

export default function DigestsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const plan = "plan" in data && data.plan ? data.plan : "free";
  const canExport = canUsePlanFeature(plan, "export_csv") && canUsePlanFeature(plan, "export_json");
  const canShare = canUsePlanFeature(plan, "share_links");
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const pendingDigestId =
    navigation.location?.pathname === "/app/digests"
      ? new URLSearchParams(navigation.location.search).get("digest")
      : null;
  const digestAttemptsByDigestId: Record<
    string,
    Array<{
      channel: string;
      targetValue: string;
      status: string;
      errorMessage: string | null;
      webhookStatus?: string | null;
      providerStatusLastSeenAt?: string | null;
      sentAt?: string | null;
      createdAt: string;
    }>
  > = data.canAccessDigests ? (data.digestAttemptsByDigestId ?? {}) : {};
  const selectedDigestAttempts: Array<{
    channel: string;
    targetValue: string;
    status: string;
    errorMessage: string | null;
    webhookStatus?: string | null;
    providerStatusLastSeenAt?: string | null;
    sentAt?: string | null;
    createdAt: string;
  }> = data.canAccessDigests ? (data.selectedDigestAttempts ?? []) : [];
  const allItems = data.canAccessDigests && data.selectedDigest ? data.selectedDigest.items : [];
  const selectedFilters = {
    competitor: searchParams.get("competitor") ?? "all",
    urgency: searchParams.get("urgency") ?? "all",
    proofStatus: searchParams.get("proofStatus") ?? "all",
    eventType: searchParams.get("eventType") ?? "all",
  };
  const filterOptions = buildDigestFilterOptions(allItems);
  const visibleItems = applyDigestFilters(allItems, selectedFilters);
  const deliveryLabel =
    selectedDigestAttempts.length > 0
      ? selectedDigestAttempts
          .map(
            (attempt) =>
              describeAttemptStatus(
                attempt.status,
                attempt.channel,
                attempt.webhookStatus ?? null,
              ),
          )
          .join(" · ")
      : data.canAccessDigests && data.selectedDigest?.delivery?.status === "sent"
        ? "Sent — predates per-recipient tracking"
        : null;
  const deliveryRecipient = selectedDigestAttempts[0]?.targetValue ?? null;

  return (
    <DashboardPage>
      <section className="f9-app-stack">
        <DashboardPageHeader
          kicker="Filed evidence"
          lead="Read each period as one brief: the finding, the captured changes, the quiet checks, and the facts behind it."
          title="Briefs"
        />

        {actionData?.message ? (
          <div
            aria-live={actionData.ok ? "polite" : "assertive"}
            className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}
            role={actionData.ok ? "status" : "alert"}
          >
            <p>
              {actionData.ok && actionData.message.startsWith("http") ? (
                <>
                  <a href={actionData.message} rel="noreferrer" target="_blank">
                    {actionData.message}
                  </a>{" "}
                  <CopyButton value={actionData.message} />
                </>
              ) : (
                actionData.message
              )}
              {!actionData.ok &&
              (actionData.error === "plan_limit_exceeded" ||
                actionData.error === "plan_gated") ? (
                <>
                  {" "}
                  <Link to="/app/billing?source=digests#plans">View plans</Link> to unlock this
                  control.
                </>
              ) : null}
            </p>
          </div>
        ) : null}

        {!data.canAccessDigests ? (
          <LockedFeature
            eyebrow="Briefs"
            headingLevel="h2"
            planNeeded="paid plans"
            reason="Get daily or weekly competitor-change briefs with evidence and check labels in your inbox"
            title="Competitor change briefs"
            upgradeLabel="See plans"
            upgradeTo="/app/billing?source=digests#plans"
          />
        ) : data.selectedDigest ? (
          <>
            <nav aria-label="Brief history" className="f9-ed-brief-history">
              <h2>Brief history</h2>
              <div className="f9-ed-brief-history-track">
                {data.digests.map((digest) => {
                  const isActive =
                    searchParams.get("digest") === digest.id ||
                    (!searchParams.get("digest") && data.selectedDigest?.id === digest.id);
                  const isPending = pendingDigestId === digest.id;
                  return (
                    <Link
                      aria-current={isActive ? "page" : undefined}
                      className={`f9-ed-brief-history-link ${isActive ? "is-active" : ""} ${isPending ? "is-pending" : ""}`}
                      key={digest.id}
                      preventScrollReset
                      to={`/app/digests?digest=${digest.id}`}
                    >
                      <LocalTime iso={digest.periodEnd} mode="date" />
                      <span>{formatDigestSidebarMovement(digest.items)}</span>
                      <span>
                        {formatDigestSidebarStatus(
                          digestAttemptsByDigestId[digest.id] ?? [],
                          digest.delivery?.status ?? null,
                        )}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </nav>

            <DigestFilterRow
              options={filterOptions}
              searchParams={searchParams}
              selected={selectedFilters}
            />

            <DesignedDigestBrief
              actions={
                <>
                  {canExport ? (
                    <>
                      <SecondaryAction href={`/export/digest/${data.selectedDigest.id}`} small>
                        Export CSV
                      </SecondaryAction>
                      <SecondaryAction
                        href={`/export/digest/${data.selectedDigest.id}?format=json`}
                        small
                      >
                        Export JSON
                      </SecondaryAction>
                    </>
                  ) : (
                    <SecondaryAction small to="/app/billing?source=digests#plans">
                      Upgrade for exports
                    </SecondaryAction>
                  )}
                  {canShare ? (
                    <Form method="post">
                      <input name="intent" type="hidden" value="share-digest" />
                      <input name="digestId" type="hidden" value={data.selectedDigest.id} />
                      <SubmitButton
                        className="f9-ed-cta f9-ed-cta--rank1 is-small"
                        intent="share-digest"
                        pendingLabel="Creating…"
                      >
                        Share snapshot
                      </SubmitButton>
                    </Form>
                  ) : (
                    <SecondaryAction small to="/app/billing?source=digests#plans">
                      Upgrade to share
                    </SecondaryAction>
                  )}
                </>
              }
              allItems={allItems}
              cohortNote={digestCohortNote(data.selectedDigest.summary)}
              createdAt={data.selectedDigest.createdAt}
              deliveryLabel={deliveryLabel}
              deliveryRecipient={deliveryRecipient}
              id="first-brief-detail"
              items={visibleItems}
              periodEnd={data.selectedDigest.periodEnd}
              periodStart={data.selectedDigest.periodStart}
              summary={data.selectedDigest.summary ?? null}
            />
          </>
        ) : (
          <>
            <nav aria-label="Brief history" className="f9-ed-brief-history">
              <h2>Brief history</h2>
              <p className="f9-ed-brief-history-empty">
                The first completed check files the first date here.
              </p>
            </nav>
            <SpecimenEmptyState
              copy="Add a competitor and the first completed check files one brief here — a finding when something moved, or an honest all-quiet line when it did not."
              headline="Your first brief lands after the first scan"
              primaryAction={{ label: "Add competitor", to: "/search" }}
              secondaryAction={{ label: "See a sample brief", to: "/#demo" }}
              specimenLabel="Brief 01 — reserved"
              stateLabel="Brief desk · no completed check yet"
            />
          </>
        )}
      </section>
    </DashboardPage>
  );
}

function DigestFilterRow({
  options,
  searchParams,
  selected,
}: {
  options: ReturnType<typeof buildDigestFilterOptions>;
  searchParams: URLSearchParams;
  selected: {
    competitor: string;
    urgency: string;
    proofStatus: string;
    eventType: string;
  };
}) {
  const filters = [
    {
      key: "competitor",
      label: "Competitor",
      selected: selected.competitor,
      allLabel: "All competitors",
      values: options.competitors.map((value) => ({ value, label: value })),
    },
    {
      key: "urgency",
      label: "Urgency",
      selected: selected.urgency,
      allLabel: "All urgency",
      values: ["high", "medium", "low"].map((value) => ({
        value,
        label: `${value[0].toUpperCase()}${value.slice(1)}`,
      })),
    },
    {
      key: "proofStatus",
      label: "Source",
      selected: selected.proofStatus,
      allLabel: "All source states",
      values: options.proofStatuses,
    },
    {
      key: "eventType",
      label: "Type",
      selected: selected.eventType,
      allLabel: "All event types",
      values: options.eventTypes.map((value) => ({
        value,
        label: formatWatchEventTypeLabel(value),
      })),
    },
  ] as const;
  const hasActiveFilter = filters.some((filter) => filter.selected !== "all");

  return (
    <nav aria-label="Filter this brief" className="f9-ed-brief-filters">
      <span className="f9-ed-micro">Filter</span>
      {filters.map((filter) => {
        const currentLabel =
          filter.selected === "all"
            ? filter.allLabel
            : filter.values.find((option) => option.value === filter.selected)?.label ??
              filter.allLabel;
        return (
          <details className="f9-ed-brief-filter" key={filter.key}>
            <summary>
              {filter.label}: {currentLabel}
            </summary>
            <div className="f9-ed-brief-filter-menu">
              <Link preventScrollReset to={digestFilterHref(searchParams, filter.key, "all")}>
                {filter.allLabel}
              </Link>
              {filter.values.map((option) => (
                <Link
                  aria-current={option.value === filter.selected ? "true" : undefined}
                  key={option.value}
                  preventScrollReset
                  to={digestFilterHref(searchParams, filter.key, option.value)}
                >
                  {option.label}
                </Link>
              ))}
            </div>
          </details>
        );
      })}
      {hasActiveFilter ? (
        <Link
          className="f9-ed-brief-filter-reset"
          preventScrollReset
          to={digestFilterResetHref(searchParams)}
        >
          Clear filters
        </Link>
      ) : null}
    </nav>
  );
}

function digestFilterHref(searchParams: URLSearchParams, key: string, value: string) {
  const next = new URLSearchParams(searchParams);
  if (value === "all") next.delete(key);
  else next.set(key, value);
  return `/app/digests${next.size > 0 ? `?${next.toString()}` : ""}`;
}

function digestFilterResetHref(searchParams: URLSearchParams) {
  const next = new URLSearchParams();
  const digestId = searchParams.get("digest");
  if (digestId) next.set("digest", digestId);
  return `/app/digests${next.size > 0 ? `?${next.toString()}` : ""}`;
}

function digestCohortNote(summary: Record<string, unknown> | undefined) {
  const total = typeof summary?.totalEligibleEvents === "number" ? summary.totalEligibleEvents : null;
  const included = typeof summary?.includedEvents === "number" ? summary.includedEvents : null;
  const omitted = typeof summary?.omittedEvents === "number" ? summary.omittedEvents : null;
  if (total === null || included === null || omitted === null || omitted <= 0) return null;
  return `Showing ${included} of ${total} eligible changes; ${omitted} lower-priority change${omitted === 1 ? "" : "s"} omitted from this digest.`;
}

function summarizeDigestAttempts<T extends {
    channel: string;
    targetValue: string;
    status: string;
    errorMessage: string | null;
    webhookStatus?: string | null;
    providerStatusLastSeenAt?: string | null;
    sentAt?: string | null;
    createdAt: string;
  }>(attempts: T[]) {
  const latestByChannelTarget = new Map<string, T>();

  for (const attempt of attempts) {
    const key = `${attempt.channel}:${attempt.targetValue}`;
    if (!latestByChannelTarget.has(key)) {
      latestByChannelTarget.set(key, attempt);
    }
  }

  return [...latestByChannelTarget.values()];
}

function formatDigestSidebarStatus(
  attempts: Array<{ channel: string; status: string; webhookStatus?: string | null }>,
  legacyStatus: string | null,
) {
  if (attempts.length === 0) {
    if (legacyStatus === "sent") {
      return "Sent — predates per-recipient tracking";
    }
    if (legacyStatus === "failed") {
      return "Delivery failed";
    }
    return "No sends recorded yet";
  }

  return attempts
    .map((attempt) => `${formatDeliveryChannelLabel(attempt.channel)} ${describeAttemptStatus(attempt.status, attempt.channel, attempt.webhookStatus ?? null).toLowerCase()}`)
    .join(" · ");
}

function formatDigestSidebarMovement(
  items: Array<{ watchlistName?: string; metadata?: Record<string, unknown> }>,
) {
  if (items.length === 0) {
    return "All quiet";
  }
  const competitors = new Set(items.map((item) => item.watchlistName).filter(Boolean));
  return `${items.length} change${items.length === 1 ? "" : "s"} · ${competitors.size} competitor${competitors.size === 1 ? "" : "s"}`;
}

function formatDeliveryChannelLabel(channel: string) {
  if (channel === "email") {
    return "Email";
  }
  if (channel === "whatsapp") {
    return "WhatsApp";
  }
  if (channel === "slack") {
    return "Slack";
  }
  return channel.replaceAll("_", " ");
}

function describeAttemptStatus(status: string, channel: string, webhookStatus: string | null) {
  switch (status) {
    case "sent":
      if (webhookStatus === "delivered") {
        return "Delivered";
      }
      if (channel === "email" && webhookStatus === "provider_unknown") {
        return "Delivery unconfirmed";
      }
      return "Sent";
    case "failed":
      return "Failed";
    case "skipped_due_to_quiet_hours":
      return "Deferred by quiet hours";
    case "skipped_due_to_dedupe":
      return "Skipped as duplicate";
    default:
      return "Pending";
  }
}

function buildDigestFilterOptions(
  items: Array<{ watchlistName: string; eventType: string; metadata?: Record<string, unknown> }>,
) {
  const proofStatuses = new Map<string, string>();
  for (const item of items) {
    const classification = classifyDigestItemSource({
      watchlistName: item.watchlistName,
      eventType: item.eventType,
      title: "",
      summary: "",
      metadata: item.metadata ?? {},
      createdAt: "",
    });
    proofStatuses.set(classification.status, classification.label);
  }

  return {
    competitors: [...new Set(items.map((item) => item.watchlistName).filter(Boolean))].sort(),
    eventTypes: [...new Set(items.map((item) => item.eventType).filter(Boolean))].sort(),
    proofStatuses: [...proofStatuses.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

function applyDigestFilters<
  T extends {
    watchlistName: string;
    eventType: string;
    metadata?: Record<string, unknown>;
  },
>(
  items: T[],
  filters: {
    competitor: string;
    urgency: string;
    proofStatus: string;
    eventType: string;
  },
) {
  return items.filter((item) => {
    const classification = classifyDigestItemSource({
      watchlistName: item.watchlistName,
      eventType: item.eventType,
      title: "",
      summary: "",
      metadata: item.metadata ?? {},
      createdAt: "",
    });
    return (
      (filters.competitor === "all" || item.watchlistName === filters.competitor) &&
      (filters.urgency === "all" || digestUrgency(item.metadata) === filters.urgency) &&
      (filters.proofStatus === "all" || classification.status === filters.proofStatus) &&
      (filters.eventType === "all" || item.eventType === filters.eventType)
    );
  });
}

function digestUrgency(metadata: Record<string, unknown> | undefined) {
  const intelligence = readDigestIntelligence(metadata ?? {});
  const score = intelligence.priorityScore;
  if (score !== null && score >= 85) return "high";
  if (score !== null && score >= 65) return "medium";
  const band = intelligence.priorityBand.toLowerCase();
  if (band.includes("high")) return "high";
  if (band.includes("medium")) return "medium";
  return "low";
}

export function readDigestSourceUrl(metadata: Record<string, unknown> | undefined) {
  for (const key of [
    "sourceUrl",
    "proofUrl",
    "landingPageUrl",
    "websiteUrl",
    "websiteProofUrl",
    "canonicalUrl",
  ]) {
    const safeUrl = readDigestHttpUrl(metadata?.[key]);
    if (safeUrl) {
      return safeUrl;
    }
  }
  return null;
}

function readDigestHttpUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}
