import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { DigestIntelligence, DigestMovementSummary, DigestProofPacket } from "~/components/digest-intelligence";
import { CopyButton } from "~/components/copy-button";
import { InsightDepthPanel } from "~/components/insight-depth-panel";
import { LocalTime } from "~/components/local-time";
import { PlanLimitState } from "~/components/plan-limit-state";
import { SubmitButton } from "~/components/submit-button";
import { readDigestIntelligence } from "~/lib/change-intelligence";
import { buildDigestInsightDepth } from "~/lib/insight-depth";
import {
  classifyDigestItemSource,
  priorityMixLabel,
  proofMixLabel,
  summarizeDigestProofMix,
  summarizePriorityMix,
} from "~/lib/proof-classification";

export const meta = () => [{ title: "Digests | Five to Nine" }];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Digests" />;
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
  const { session, workspaceUserId } = await requireWorkspaceSession(env, request);
  const plan = await getUserPlan(env, workspaceUserId);

  if (!PLAN_LIMITS[plan].digests) {
    return {
      digests: [],
      selectedDigest: null,
      canAccessDigests: false,
    };
  }

  const digests = await listDigests(env, workspaceUserId);
  const recentDeliveryAttempts = await listDeliveryAttempts(env, {
    userId: workspaceUserId,
    limit: 80,
  });
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
        ),
      ]),
    ),
    selectedDigest,
    selectedDigestAttempts: selectedDigest
      ? summarizeDigestAttempts(
          recentDeliveryAttempts.filter((attempt) => attempt.digestRunId === selectedDigest.id),
        )
      : [],
    canAccessDigests: true,
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
      message: "Digests are included in paid plans — upgrade to turn them on.",
    };
  }

  if (intent === "share-digest") {
    const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
    const shareGate = await requireWorkspacePlanFeature(env, workspaceUserId, "share_links");
    if (!shareGate.ok) {
      return { ok: false, message: "Share links are included in the Agency plan." };
    }
    const digestId = String(formData.get("digestId") ?? "");
    const digest = await getDigest(env, digestId);

    if (!digest || digest.userId !== workspaceUserId) {
      return {
        ok: false,
        message: "Digest not found.",
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
    message: "Unknown digest action.",
  };
}

export default function DigestsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
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
  const insightDepth = data.canAccessDigests && data.selectedDigest
    ? buildDigestInsightDepth(data.selectedDigest.items)
    : null;
  const allItems = data.canAccessDigests && data.selectedDigest ? data.selectedDigest.items : [];
  const selectedFilters = {
    competitor: searchParams.get("competitor") ?? "all",
    urgency: searchParams.get("urgency") ?? "all",
    proofStatus: searchParams.get("proofStatus") ?? "all",
    eventType: searchParams.get("eventType") ?? "all",
  };
  const filterOptions = buildDigestFilterOptions(allItems);
  const visibleItems = applyDigestFilters(allItems, selectedFilters);
  const proofMix = summarizeDigestProofMix(allItems);
  const priorityMix = summarizePriorityMix(allItems);

  return (
    <DashboardPage>
      <section className="f9-app-stack">
        <DashboardPageHeader
          lead="Review competitor changes with proof, scan labels, history, and delivery health."
          title="Digests"
        />

      {actionData?.message ? (
        <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
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
          </p>
        </div>
      ) : null}

      {!data.canAccessDigests ? (
        <PlanLimitState
          message="Digests are included in paid plans. Upgrade to get daily or weekly competitor change briefs with proof and scan labels in your inbox. Until then, watchlists and collections keep your research organized."
          title="Digests are included in paid plans"
        />
      ) : (
        <div className="f9-dashboard-grid">
          <article className="f9-app-panel f9-side-panel">
            <div className="f9-panel-toolbar">
              <div>
                <h2>Digest history</h2>
              </div>
            </div>

            <div className="f9-work-list is-compact">
              {data.digests.map((digest) => (
                <a
                  className={`f9-work-row ${searchParams.get("digest") === digest.id || (!searchParams.get("digest") && data.selectedDigest?.id === digest.id) ? "is-active" : ""}`}
                  href={`/app/digests?digest=${digest.id}`}
                  key={digest.id}
                >
                  <div>
                    <h3><LocalTime iso={digest.periodEnd} mode="date" /></h3>
                    <p className="f9-muted-copy">
                      {formatDigestSidebarMovement(digest.items)}
                    </p>
                    <p className="f9-muted-copy">
                      {formatDigestSidebarStatus(
                        digestAttemptsByDigestId[digest.id] ?? [],
                        digest.delivery?.status ?? null,
                      )}
                    </p>
                  </div>
                </a>
              ))}
              {data.digests.length === 0 ? (
                <div className="f9-empty-panel">
                  <h3>Your first digest appears after monitoring runs</h3>
                  <p>Start a competitor watchlist and digest history will show both movement and all-quiet periods.</p>
                </div>
              ) : null}
            </div>
          </article>

          <article className="f9-app-panel">
            {data.selectedDigest ? (
              <>
                <div className="f9-panel-toolbar">
                  <div>
                    <span className="f9-app-kicker">Selected digest</span>
                    <h2>
                      <LocalTime iso={data.selectedDigest.periodStart} mode="date" /> to{" "}
                      <LocalTime iso={data.selectedDigest.periodEnd} mode="date" />
                    </h2>
                  </div>
                  <div className="f9-action-row">
                    <a
                      className="f9-secondary-button"
                      href={`/export/digest/${data.selectedDigest.id}`}
                    >
                      Export CSV
                    </a>
                    <a
                      className="f9-secondary-button"
                      href={`/export/digest/${data.selectedDigest.id}?format=json`}
                    >
                      JSON export
                    </a>
                    <Form method="post">
                      <input name="intent" type="hidden" value="share-digest" />
                      <input name="digestId" type="hidden" value={data.selectedDigest.id} />
                      <SubmitButton className="f9-primary-button" intent="share-digest" pendingLabel="Creating…">
                        Share snapshot
                      </SubmitButton>
                    </Form>
                  </div>
                </div>

                {insightDepth ? <InsightDepthPanel summary={insightDepth} /> : null}

                <DigestProofPacket items={data.selectedDigest.items} />

                <DigestMovementSummary items={data.selectedDigest.items} />

                <section className="f9-work-list is-compact" style={{ marginBottom: "1rem" }}>
                  <div>
                    <span className="f9-app-kicker">Filters</span>
                    <h3 style={{ marginTop: 0 }}>Full digest detail</h3>
                    <p className="f9-muted-copy">
                      {priorityMixLabel(priorityMix)} · {proofMixLabel(proofMix)}
                    </p>
                  </div>
                  <Form method="get" className="f9-filter-row">
                    <input name="digest" type="hidden" value={data.selectedDigest.id} />
                    <label>
                      Competitor
                      <select name="competitor" defaultValue={selectedFilters.competitor}>
                        <option value="all">All competitors</option>
                        {filterOptions.competitors.map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Urgency
                      <select name="urgency" defaultValue={selectedFilters.urgency}>
                        <option value="all">All urgency</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                    </label>
                    <label>
                      Proof
                      <select name="proofStatus" defaultValue={selectedFilters.proofStatus}>
                        <option value="all">All proof states</option>
                        {filterOptions.proofStatuses.map((status) => (
                          <option key={status.value} value={status.value}>{status.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Type
                      <select name="eventType" defaultValue={selectedFilters.eventType}>
                        <option value="all">All event types</option>
                        {filterOptions.eventTypes.map((type) => (
                          <option key={type} value={type}>{type.replaceAll("_", " ")}</option>
                        ))}
                      </select>
                    </label>
                    <SubmitButton className="f9-secondary-button" getAction="/app/digests" pendingLabel="Filtering…">
                      Apply
                    </SubmitButton>
                  </Form>
                </section>

                <ul className="event-list">
                  {visibleItems.map((item) => {
                    const classification = classifyDigestItemSource(item);
                    const sourceUrl = readDigestSourceUrl(item.metadata);
                    return (
                    <li className="f9-event-card" key={item.id}>
                      <div className="f9-panel-toolbar">
                        <div>
                          <span className="f9-app-kicker">{item.watchlistName}</span>
                          <h3>{item.title}</h3>
                        </div>
                        <div className="f9-action-row">
                          <span className="f9-status-pill">{classification.label}</span>
                          <span className="f9-status-pill">{item.eventType.replaceAll("_", " ")}</span>
                        </div>
                      </div>
                      <p>{item.summary}</p>
                      <dl className="proof-trail-list">
                        <div>
                          <dt>Source type</dt>
                          <dd>{classification.sourceTypeLabel}</dd>
                        </div>
                        <div>
                          <dt>Captured</dt>
                          <dd>{readDigestTimestamp(item.metadata) ? <LocalTime iso={readDigestTimestamp(item.metadata)!} /> : "Timestamp unavailable"}</dd>
                        </div>
                        {sourceUrl ? (
                          <div>
                            <dt>Source link</dt>
                            <dd>
                              <a href={sourceUrl} rel="noreferrer" target="_blank">Open source</a>
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                      <DigestIntelligence metadata={item.metadata} />
                    </li>
                    );
                  })}
                </ul>
                {visibleItems.length === 0 ? (
                  <div className="f9-empty-panel">
                    <h3>{allItems.length === 0 ? "All quiet for this period" : "No changes match these filters"}</h3>
                    <p>
                      {allItems.length === 0
                        ? "This digest was generated after monitoring completed without action-worthy competitor movement."
                        : "Adjust the filters to see more digest items."}
                    </p>
                  </div>
                ) : null}

                <section className="f9-work-list is-compact" style={{ marginTop: "1rem" }}>
                  <div>
                    <span className="f9-app-kicker">Delivery health</span>
                    <h3 style={{ marginTop: 0 }}>Recent channel outcomes</h3>
                  </div>
                  {selectedDigestAttempts.length > 0 ? (
                    selectedDigestAttempts.map((attempt) => (
                      <div className="f9-work-row" key={`${attempt.channel}:${attempt.targetValue}`}>
                        <div>
                          <h4 style={{ marginBottom: "0.25rem" }}>
                            {formatDeliveryChannelLabel(attempt.channel)}
                          </h4>
                          <p className="f9-muted-copy" style={{ marginBottom: "0.25rem" }}>
                            {describeAttemptStatus(attempt.status, attempt.channel, attempt.webhookStatus ?? null)}
                          </p>
                          <p className="f9-muted-copy">{attempt.targetValue}</p>
                          {attempt.providerStatusLastSeenAt ? (
                            <p className="f9-muted-copy">
                              Provider status checked <LocalTime iso={attempt.providerStatusLastSeenAt} />
                            </p>
                          ) : null}
                          {attempt.errorMessage ? (
                            <p className="f9-muted-copy">{attempt.errorMessage}</p>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="f9-muted-copy">
                      {data.selectedDigest.delivery?.status === "sent"
                        ? "Legacy provider send recorded. Recipient delivery is unknown."
                        : "No channel-level delivery attempts recorded yet."}
                    </p>
                  )}
                </section>
              </>
            ) : (
              <div className="f9-empty-panel">
                <h2>Your first digest appears after monitoring runs</h2>
                <p>Digest history will show both competitor movement and all-quiet periods.</p>
                <Link className="f9-primary-button" to="/app/watchlists">
                  Open watchlists
                </Link>
              </div>
            )}
          </article>
        </div>
      )}
      </section>
    </DashboardPage>
  );
}

function summarizeDigestAttempts(
  attempts: Array<{
    channel: string;
    targetValue: string;
    status: string;
    errorMessage: string | null;
    webhookStatus?: string | null;
    providerStatusLastSeenAt?: string | null;
    sentAt?: string | null;
    createdAt: string;
  }>,
) {
  const latestByChannelTarget = new Map<string, (typeof attempts)[number]>();

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
      return "Legacy provider send recorded";
    }
    if (legacyStatus === "failed") {
      return "Delivery failed";
    }
    return "Waiting for delivery activity";
  }

  return attempts
    .map((attempt) => `${formatDeliveryChannelLabel(attempt.channel)} ${describeAttemptStatus(attempt.status, attempt.channel, attempt.webhookStatus ?? null).toLowerCase()}`)
    .join(" · ");
}

function formatDigestSidebarMovement(items: Array<{ metadata?: Record<string, unknown> }>) {
  if (items.length === 0) {
    return "All quiet period";
  }
  const proofMix = summarizeDigestProofMix(
    items.map((item) => ({
      watchlistName: "",
      eventType: "ad_new",
      title: "",
      summary: "",
      metadata: item.metadata ?? {},
      createdAt: "",
    })),
  );
  return `${items.length} change${items.length === 1 ? "" : "s"} · ${proofMixLabel(proofMix)}`;
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
      if (channel === "email") {
        return "Provider accepted";
      }
      return "Sent to provider";
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

function readDigestTimestamp(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.confirmedAt ?? metadata?.capturedAt ?? metadata?.createdAt;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readDigestSourceUrl(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.sourceUrl ?? metadata?.proofUrl ?? metadata?.landingPageUrl;
  return typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;
}
