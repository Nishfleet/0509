import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DashboardPage } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { DesignedDigestBrief } from "~/components/digest-intelligence";
import { CopyButton } from "~/components/copy-button";
import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
import { FeedbackStrip } from "~/components/workspace/feedback-strip";
import { RuledList, RuledRow } from "~/components/workspace/ruled-list";
import { WorkingHeader } from "~/components/workspace/working-header";
import { readDigestIntelligence } from "~/lib/change-intelligence";
import {
  DIGEST_REVIEWER_UNAVAILABLE,
  digestConfidenceLabel,
  digestFreshUntilLabel,
  digestMaterialityReason,
  digestNextAction,
  digestReviewerLabel,
} from "~/lib/change-intelligence";
import { deriveBriefRetentionFields } from "~/lib/brief-retention";
import { toPublicDeliveryAttemptSummary } from "~/lib/delivery-attempt-public";
import { formatWatchEventTypeLabel } from "~/lib/landing-page-display";
import { canUsePlanFeature, getPlanEntitlements } from "~/lib/plan-entitlements";
import { classifyDigestItemSource } from "~/lib/proof-classification";
import { formatNextScanLabel, nextScheduledScanAt } from "~/lib/schedule-display";
import { readTriageFromDigestSummary } from "~/lib/watch-period-triage";

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
  const { session, workspaceUserId, isMember, ownerName } =
    await requireWorkspaceSession(env, request);
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
    // E3 (2026-08-11): the brief as a retention loop — every brief states
    // how confident its claims are and when the workspace's next scheduled
    // check refreshes them. The scan cadence comes from the plan
    // entitlements, the digest cadence from the filed period span.
    scanCadence: getPlanEntitlements(plan).scheduledScanCadence,
    selectedDigestCadence: selectedDigest
      ? digestCadenceFromPeriod(selectedDigest.periodStart, selectedDigest.periodEnd)
      : null,
    // E2 (2026-08-08): the accountable reviewer is the already-available
    // workspace owner identity — never invented from event text. A workspace
    // member has no claim to the owner's briefs, so their own name is only
    // used when they are the owner (single-user workspace); a null name
    // renders the explicit failure state in the UI.
    reviewerName:
      ownerName ??
      (!isMember ? session.user.name ?? session.user.email ?? null : null),
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
  // E2 (2026-08-08): every brief carries one materiality reason, one
  // accountable reviewer, and one next action — derived from the filed
  // events and the persisted period triage, with the reviewer taken from the
  // workspace owner identity only. Missing values render their explicit
  // failure state instead of a silent generic brief.
  // E3 (2026-08-11): the brief as a retention loop — confidence and the
  // next-check freshness line ride the same block, so a reader always knows
  // what to trust and when the brief's claims get refreshed.
  const selectedTriage =
    data.canAccessDigests && data.selectedDigest
      ? readTriageFromDigestSummary(data.selectedDigest.summary ?? null)
      : null;
  const accountability =
    data.canAccessDigests && data.selectedDigest
      ? {
          materialityReason: digestMaterialityReason({
            items: data.selectedDigest.items,
            triage: selectedTriage,
          }),
          reviewerLabel: data.reviewerName
            ? digestReviewerLabel(data.reviewerName)
            : DIGEST_REVIEWER_UNAVAILABLE,
          nextAction: digestNextAction({
            items: data.selectedDigest.items,
            triage: selectedTriage,
          }),
          confidenceLabel: digestConfidenceLabel({
            items: data.selectedDigest.items,
            triage: selectedTriage,
          }),
          freshUntilLabel: digestFreshUntilLabel({
            cadence: data.selectedDigestCadence ?? null,
            scanCadence: data.scanCadence ?? null,
            after: selectedTriage?.checkedAt ?? data.selectedDigest.periodEnd,
          }),
        }
      : null;
  // Brief-as-retention-loop (lane 1, 2026-08-14): the archived brief page
  // also carries the four retention fields — delta, owner, confidence,
  // expiry. The previous brief is the digest on file strictly older than
  // the selected one; absent that, the delta line says "first brief on
  // file" instead of inventing a comparison.
  const previousBriefForRetention =
    data.canAccessDigests && data.selectedDigest
      ? data.digests.find(
          (candidate) =>
            candidate.id !== data.selectedDigest!.id &&
            candidate.periodEnd < data.selectedDigest!.periodEnd,
        ) ?? null
      : null;
  const retentionNextScanAt =
    data.canAccessDigests && data.selectedDigest
      ? nextScheduledScanAt(plan, new Date()).toISOString()
      : null;
  const retentionNextScanLabel =
    data.canAccessDigests && data.selectedDigest
      ? formatNextScanLabel(plan, new Date(), null)
      : null;
  const retention =
    data.canAccessDigests && data.selectedDigest
      ? deriveBriefRetentionFields({
          items: data.selectedDigest.items,
          previousBrief: previousBriefForRetention,
          ownerName: data.reviewerName,
          nextScanAt: retentionNextScanAt,
          nextScanLabel: retentionNextScanLabel,
        })
      : null;
  const deliveryLabel =
    selectedDigestAttempts.length > 0
      ? selectedDigestAttempts
          .map(
            (attempt) =>
              describeAttemptStatus(
                attempt.status,
                attempt.webhookStatus ?? null,
              ),
          )
          .join(" · ")
      : data.canAccessDigests && data.selectedDigest?.delivery?.status === "sent"
        ? "Sent — predates per-recipient tracking"
        : null;
  const deliveryRecipient = selectedDigestAttempts[0]?.targetValue ?? null;
  const headerAction = !data.canAccessDigests
    ? { label: "See plans", to: "/app/billing?source=digests#plans" }
    : data.selectedDigest
      ? null
      : { label: "Add competitor", to: "/search" };
  const newestVisibleFilingAt =
    data.canAccessDigests && data.selectedDigest
      ? newestVisibleDigestCreatedAt(data.digests, data.selectedDigest.createdAt)
      : null;
  const headerContext = !data.canAccessDigests ? (
    "This workspace does not include retained briefs."
  ) : data.selectedDigest ? (
    <>
      Showing {data.digests.length} recent brief{data.digests.length === 1 ? "" : "s"} on
      file. Newest filing shown{" "}
      <LocalTime iso={newestVisibleFilingAt ?? data.selectedDigest.createdAt} />.
    </>
  ) : (
    "No briefs filed yet. The first completed check files one here."
  );

  return (
    <DashboardPage className="f9-wk-page f9-wk-briefs">
      <WorkingHeader action={headerAction} context={headerContext} title="Briefs" />

      {actionData?.message ? (
        <FeedbackStrip
          actions={
            actionData.ok && actionData.message.startsWith("http") ? (
              <CopyButton value={actionData.message} />
            ) : undefined
          }
          label={actionData.ok ? "Share ready" : "Not done"}
          tone={actionData.ok ? "ok" : "bad"}
        >
          {actionData.ok && actionData.message.startsWith("http") ? (
            <a href={actionData.message} rel="noreferrer" target="_blank">
              {actionData.message}
            </a>
          ) : (
            actionData.message
          )}
          {!actionData.ok &&
          "error" in actionData &&
          (actionData.error === "plan_limit_exceeded" || actionData.error === "plan_gated") ? (
            <>
              {" "}
              <Link to="/app/billing?source=digests#plans">View plans</Link> to unlock this
              control.
            </>
          ) : null}
        </FeedbackStrip>
      ) : null}

      {!data.canAccessDigests ? (
        <section aria-labelledby="briefs-locked-title" className="f9-wk-sec f9-wk-quiet-state">
          <h2 id="briefs-locked-title">Competitor change briefs</h2>
          <p>
            This plan does not retain competitor-change briefs in the workspace. See plans
            to turn on the filed reading history.
          </p>
        </section>
      ) : data.selectedDigest ? (
        <>
          <section aria-labelledby="brief-history-title" className="f9-wk-sec">
            <h2 className="f9-wk-kick" id="brief-history-title">
              Brief history
            </h2>
            <RuledList aria-label="Brief history">
              {data.digests.map((digest) => {
                const isActive =
                  searchParams.get("digest") === digest.id ||
                  (!searchParams.get("digest") && data.selectedDigest?.id === digest.id);
                const isPending = pendingDigestId === digest.id;
                return (
                  <RuledRow
                    key={digest.id}
                    name={<LocalTime iso={digest.periodEnd} mode="date" />}
                    pending={isPending}
                    plain
                    say={formatDigestSidebarMovement(digest.items)}
                    selected={isActive}
                    status={formatDigestSidebarStatus(
                      digestAttemptsByDigestId[digest.id] ?? [],
                      digest.delivery?.status ?? null,
                    )}
                    time={
                      <>
                        Filed <LocalTime iso={digest.createdAt} />
                      </>
                    }
                    to={`/app/digests?digest=${digest.id}#first-brief-detail`}
                  />
                );
              })}
            </RuledList>
          </section>

          <DigestFilterRow
            options={filterOptions}
            searchParams={searchParams}
            selected={selectedFilters}
          />

          {accountability ? (
            <section
              aria-labelledby="brief-accountability-title"
              className="f9-wk-sec"
            >
              <h2 className="f9-wk-kick" id="brief-accountability-title">
                Why this matters
              </h2>
              <p>{accountability.materialityReason}</p>
              <dl className="f9-wk-dl">
                <div className="f9-wk-contents">
                  <dt>Accountable reviewer</dt>
                  <dd>{accountability.reviewerLabel}</dd>
                </div>
                <div className="f9-wk-contents">
                  <dt>Next action</dt>
                  <dd>{accountability.nextAction}</dd>
                </div>
                <div className="f9-wk-contents">
                  <dt>Confidence</dt>
                  <dd>{accountability.confidenceLabel}</dd>
                </div>
                <div className="f9-wk-contents">
                  <dt>Fresh until</dt>
                  <dd>{accountability.freshUntilLabel}</dd>
                </div>
              </dl>
            </section>
          ) : null}

          {retention ? (
            <section
              aria-labelledby="brief-retention-title"
              className="f9-wk-sec"
            >
              <h2 className="f9-wk-kick" id="brief-retention-title">
                Brief retention
              </h2>
              <dl className="f9-wk-dl">
                <div className="f9-wk-contents">
                  <dt>Since last brief</dt>
                  <dd>{retention.delta}</dd>
                </div>
                <div className="f9-wk-contents">
                  <dt>Accountable reviewer</dt>
                  <dd>{retention.owner}</dd>
                </div>
                <div className="f9-wk-contents">
                  <dt>Confidence</dt>
                  <dd>{retention.confidenceLabel}</dd>
                </div>
                <div className="f9-wk-contents">
                  <dt>Expiry</dt>
                  <dd>{retention.expiry}</dd>
                </div>
              </dl>
            </section>
          ) : null}

          <DesignedDigestBrief
            actions={
              <>
                {canExport ? (
                  <>
                    <a
                      className="f9-wk-lnk"
                      href={`/export/digest/${data.selectedDigest.id}`}
                    >
                      Export CSV <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
                    </a>
                    <a
                      className="f9-wk-lnk"
                      href={`/export/digest/${data.selectedDigest.id}?format=json`}
                    >
                      Export JSON <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
                    </a>
                  </>
                ) : (
                  <Link className="f9-wk-lnk" to="/app/billing?source=digests#plans">
                    Upgrade for exports{" "}
                    <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
                  </Link>
                )}
                {canShare ? (
                  <Form method="post">
                    <input name="intent" type="hidden" value="share-digest" />
                    <input name="digestId" type="hidden" value={data.selectedDigest.id} />
                    <SubmitButton
                      className="f9-wk-btn"
                      intent="share-digest"
                      pendingLabel="Creating…"
                    >
                      Share snapshot
                    </SubmitButton>
                  </Form>
                ) : (
                  <Link className="f9-wk-lnk" to="/app/billing?source=digests#plans">
                    Upgrade to share{" "}
                    <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
                  </Link>
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
        <section aria-labelledby="briefs-empty-title" className="f9-wk-sec f9-wk-quiet-state">
          <h2 id="briefs-empty-title">Your first brief lands after the first scan</h2>
          <p>
            Add a competitor and the first completed check files one brief here — a finding
            when something moved, or an honest all-quiet line when it did not.
          </p>
          <Link className="f9-wk-lnk" to="/#demo">
            See a proof brief <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
          </Link>
        </section>
      )}
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
    <nav aria-label="Filter this brief" className="f9-wk-brief-filters">
      <span className="f9-wk-brief-filter-label">Filter</span>
      {filters.map((filter) => {
        const currentLabel =
          filter.selected === "all"
            ? filter.allLabel
            : filter.values.find((option) => option.value === filter.selected)?.label ??
              filter.allLabel;
        return (
          <details className="f9-wk-brief-filter" key={filter.key}>
            <summary>
              {filter.label}: {currentLabel}
            </summary>
            <div className="f9-wk-brief-filter-menu">
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
          className="f9-wk-brief-filter-reset"
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

/** Daily digests cover one day; anything longer is the weekly brief. */
function digestCadenceFromPeriod(
  periodStart: string,
  periodEnd: string,
): "daily" | "weekly" {
  const spanMs = new Date(periodEnd).getTime() - new Date(periodStart).getTime();
  return Number.isFinite(spanMs) && spanMs <= 36 * 60 * 60 * 1000 ? "daily" : "weekly";
}

export function newestVisibleDigestCreatedAt(
  digests: Array<{ createdAt: string }>,
  fallback: string,
) {
  return digests.reduce((latest, digest) => {
    const candidateTime = Date.parse(digest.createdAt);
    const latestTime = Date.parse(latest);
    return !Number.isNaN(candidateTime) &&
      (Number.isNaN(latestTime) || candidateTime > latestTime)
      ? digest.createdAt
      : latest;
  }, fallback);
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
    .map((attempt) => `${formatDeliveryChannelLabel(attempt.channel)} ${describeAttemptStatus(attempt.status, attempt.webhookStatus ?? null).toLowerCase()}`)
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

function describeAttemptStatus(status: string, webhookStatus: string | null) {
  switch (status) {
    case "sent":
      if (webhookStatus === "delivered") {
        return "Delivered";
      }
      return "Delivery unconfirmed";
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
