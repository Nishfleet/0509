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
import { buildDigestInsightDepth } from "~/lib/insight-depth";
import { isSlackDeliveryCustomerFacing } from "~/lib/ga-customer-surface";

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

    const share = await createShareLink(
      env,
      { ...session, user: { ...session.user, id: workspaceUserId } },
      {
      resourceType: "digest",
      resourceId: digest.id,
      isSnapshot: true,
      snapshotPayload: digest as unknown as Record<string, unknown>,
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
  const showSlackDelivery = isSlackDeliveryCustomerFacing();
  const [searchParams] = useSearchParams();
  const digestAttemptsByDigestId: Record<
    string,
    Array<{
      channel: string;
      targetValue: string;
      status: string;
      errorMessage: string | null;
      createdAt: string;
    }>
  > = data.canAccessDigests ? (data.digestAttemptsByDigestId ?? {}) : {};
  const selectedDigestAttempts: Array<{
    channel: string;
    targetValue: string;
    status: string;
    errorMessage: string | null;
    createdAt: string;
  }> = data.canAccessDigests ? (data.selectedDigestAttempts ?? []) : [];
  const insightDepth = data.canAccessDigests && data.selectedDigest
    ? buildDigestInsightDepth(data.selectedDigest.items)
    : null;

  return (
    <DashboardPage>
      <section className="f9-app-stack">
        <DashboardPageHeader
          lead="Review generated change briefs with proof attached before they reach your inbox."
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
          message="Digests are included in paid plans. Upgrade to get daily or weekly competitor change reports — with proof attached — in your inbox. Until then, watchlists and boards keep your research organized."
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
                      {digest.items.length} proof-backed changes ready for review
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
                  <h3>Your first brief appears after a confirmed change</h3>
                  <p>Start a competitor watchlist and proof-backed changes will roll into digest history.</p>
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
                    {showSlackDelivery ? (
                    <a
                      className="f9-secondary-button"
                      href={`/export/digest/${data.selectedDigest.id}?format=slack`}
                    >
                      Slack copy
                    </a>
                    ) : null}
                    <Form method="post">
                      <input name="intent" type="hidden" value="share-digest" />
                      <input name="digestId" type="hidden" value={data.selectedDigest.id} />
                      <SubmitButton className="f9-primary-button" intent="share-digest" pendingLabel="Creating…">
                        Share snapshot
                      </SubmitButton>
                    </Form>
                  </div>
                </div>

                <section className="f9-work-list is-compact" style={{ marginBottom: "1rem" }}>
                  <div>
                    <span className="f9-app-kicker">Delivery status</span>
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
                            {describeAttemptStatus(attempt.status)}
                          </p>
                          <p className="f9-muted-copy">{attempt.targetValue}</p>
                          {attempt.errorMessage ? (
                            <p className="f9-muted-copy">{attempt.errorMessage}</p>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="f9-muted-copy">
                      {data.selectedDigest.delivery?.status === "sent"
                        ? "Legacy email delivery recorded."
                        : "No channel-level delivery attempts recorded yet."}
                    </p>
                  )}
                </section>

                {insightDepth ? <InsightDepthPanel summary={insightDepth} /> : null}

                <DigestProofPacket items={data.selectedDigest.items} />

                <DigestMovementSummary items={data.selectedDigest.items} />

                <ul className="event-list">
                  {data.selectedDigest.items.map((item) => (
                    <li className="f9-event-card" key={item.id}>
                      <div className="f9-panel-toolbar">
                        <div>
                          <span className="f9-app-kicker">{item.watchlistName}</span>
                          <h3>{item.title}</h3>
                        </div>
                        <span className="f9-status-pill">{item.eventType.replaceAll("_", " ")}</span>
                      </div>
                      <p>{item.summary}</p>
                      <DigestIntelligence metadata={item.metadata} />
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="f9-empty-panel">
                <h2>Your first brief appears after a confirmed change</h2>
                <p>Once a watchlist finds proof-backed movement, the generated snapshot shows up here.</p>
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
  attempts: Array<{ channel: string; status: string }>,
  legacyStatus: string | null,
) {
  if (attempts.length === 0) {
    if (legacyStatus === "sent") {
      return "Delivered";
    }
    if (legacyStatus === "failed") {
      return "Delivery failed";
    }
    return "Waiting for delivery activity";
  }

  return attempts
    .map((attempt) => `${formatDeliveryChannelLabel(attempt.channel)} ${describeAttemptStatus(attempt.status).toLowerCase()}`)
    .join(" · ");
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

function describeAttemptStatus(status: string) {
  switch (status) {
    case "sent":
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
